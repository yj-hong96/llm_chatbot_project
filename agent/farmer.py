## Version: 5.0 - 조건부 라우팅을 통한 지능형 워크플로우 최적화
import os
import re
import time
import asyncio
import logging
from dotenv import load_dotenv
from groq import Groq, RateLimitError
from typing import TypedDict, List, Literal
from langchain_core.messages import HumanMessage, AIMessage, BaseMessage
from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings
from pymilvus import connections, Collection
from langgraph.graph import StateGraph, END

# --- 1. 로깅 및 초기 설정 ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

load_dotenv()
try:
    groq_client = Groq()
except Exception as e:
    logger.error(f"Groq 클라이언트를 초기화할 수 없습니다: {e}")
    exit()

MILVUS_HOST = "localhost"
MILVUS_PORT = "19530"
COLLECTION_NAME = "farmer"
EMBEDDING_MODEL = "jhgan/ko-sroberta-multitask"
LLM_TEMPERATURE = 0.7

logger.info("임베딩 모델을 로드합니다...")
embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)

logger.info("Milvus에 연결하고 컬렉션을 로드합니다...")
try:
    connections.connect("default", host=MILVUS_HOST, port=MILVUS_PORT)
    farmer_collection = Collection(COLLECTION_NAME)
    farmer_collection.load()
    logger.info("Milvus 컬렉션 로드 완료.")
except Exception as e:
    logger.error(f"Milvus 컬렉션을 로드할 수 없습니다: {e}")
    exit()

# --- 2. LangGraph 상태 및 노드 정의 ---
class AgentState(TypedDict):
    messages: List[BaseMessage]
    documents: List[Document]
    rewritten_query: str
    original_query: str

def rewrite_query(state: AgentState) -> AgentState:
    """대화 기록을 바탕으로 사용자의 마지막 질문을 검색용 질문으로 재작성합니다."""
    messages = state['messages']
    last_message = messages[-1]
    original_query = last_message.content
    
    if len(messages) == 1:
        logger.info("첫 질문이므로 쿼리 재작성을 건너뜁니다.")
        return {"rewritten_query": original_query, "original_query": original_query}

    history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in messages[:-1]])
    
    logger.info("\n--- Query Rewriter 실행 ---")
    rewrite_prompt = f"""당신은 사용자의 질문과 대화 기록을 분석하여, 검색에 가장 적합한 '검색용 질문'을 생성하는 전문가입니다.

[대화 기록]
{history_str}

[사용자의 최신 질문]
{original_query}

[지침]
1.  **의도 파악**: 사용자의 최신 질문이 '새로운 추천'을 원하는 것인지, 아니면 이전에 언급된 작물에 대한 '상세 설명'(예: 재배 방법, 병해충)을 원하는 것인지 파악하세요.
2.  **'상세 설명' 요청 처리**: 만약 질문이 '상세 설명'에 해당한다면, [대화 기록]에서 언급된 모든 작물 이름(예: 비트, 양파, 상추)을 찾아내고, 각 작물에 대한 구체적인 질문(예: "비트 재배 방법", "양파 재배 방법")을 생성하세요. 생성된 모든 질문을 '또는' 이라는 키워드로 연결하여 하나의 긴 질문으로 만드세요.
3.  **'새로운 추천' 요청 처리**: 만약 질문이 '새로운 추천'에 해당한다면, [대화 기록]의 조건과 새로운 작물을 결합하여 하나의 검색 질문(예: "고랭지 지역에 감자를 포함하여 추천")을 만드세요.
4.  **출력 형식**: 최종 결과는 오직 재작성된 '질문' 한 줄이어야 합니다.

[예시 1: 상세 설명 요청]
- 이전 대화: 챗봇: ...비트, 양파, 상추를 추천합니다.
- 사용자 질문: 재배 방법은 어떻게 돼?
- 재작성된 검색용 질문: 비트 재배 방법 또는 양파 재배 방법 또는 상추 재배 방법

[예시 2: 새로운 추천 요청]
- 이전 대화: 고랭지 작물로 셀러리를 추천함.
- 사용자 질문: 감자는 어때?
- 재작성된 검색용 질문: 고랭지 지역에 셀러리와 감자를 포함하여 추천

[실제 재작성 작업]
[재작성된 검색용 질문]"""

    try:
        chat_completion = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": rewrite_prompt}],
            model="llama-3.1-8b-instant",
            temperature=0.0
        )
        rewritten_query = chat_completion.choices[0].message.content.strip()
        logger.info(f"재작성된 질문: {rewritten_query}")
        return {"rewritten_query": rewritten_query, "original_query": original_query}
    except Exception as e:
        logger.error(f"쿼리 재작성 중 오류 발생: {e}")
        return {"rewritten_query": original_query, "original_query": original_query}

def retrieve_documents_hybrid(state: AgentState) -> AgentState:
    """재작성된 질문을 기반으로 하이브리드 검색을 수행합니다."""
    rewritten_query = state['rewritten_query']
    logger.info(f"\n--- Retriever 실행 (검색 질문: '{rewritten_query[:50]}...') ---")
    
    query_vector = embeddings.embed_query(rewritten_query)
    search_params = {"metric_type": "L2", "params": {"nprobe": 10}}
    vector_results = farmer_collection.search(data=[query_vector], anns_field="vector", param=search_params, limit=5, output_fields=["text", "source", "page"])
    keywords = re.split(r'\s|또는', rewritten_query)
    keyword_results = []
    if keywords:
        safe_keywords = [re.sub(r'[^가-힣\w]', '', kw) for kw in keywords if kw]
        if safe_keywords:
            keyword_expr = " or ".join([f"text like '%{keyword}%'" for keyword in safe_keywords])
            keyword_results = farmer_collection.query(expr=keyword_expr, limit=5, output_fields=["text", "source", "page"])
    all_hits = (vector_results[0] if vector_results and vector_results[0] else []) + keyword_results
    unique_docs = {}
    for hit in all_hits:
        doc_content = hit.get('text') if isinstance(hit, dict) else hit.entity.get('text')
        if doc_content not in unique_docs:
            source = hit.get('source') if isinstance(hit, dict) else hit.entity.get('source')
            page = hit.get('page') if isinstance(hit, dict) else hit.entity.get('page')
            unique_docs[doc_content] = Document(page_content=doc_content, metadata={"source": source, "page": page})
    retrieved_docs = list(unique_docs.values())
    logger.info(f"최종 검색된 고유 문서 {len(retrieved_docs)}개")
    return {"documents": retrieved_docs}

def generate_final_response(state: AgentState) -> dict:
    """사용자의 원본 질문 의도에 맞춰 최종 답변을 생성합니다."""
    logger.info("--- Generator 실행 (최종 답변 생성) ---")
    messages = state['messages']
    documents = state['documents']
    original_query = state['original_query']
    context = "\n\n".join([f"[출처: {doc.metadata.get('source', '알 수 없음')}, {doc.metadata.get('page', 'N/A')}페이지]\n{doc.page_content}" for doc in documents])
    history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in messages[:-1]])

    final_prompt = f"""당신은 사용자의 질문 의도를 파악하고, 그에 맞춰 검색된 정보를 종합하여 완벽한 답변을 생성하는 '농업 전문 AI'입니다.

[이전 대화 기록]
{history_str}

[검색된 참고 정보]
{context}

[사용자의 최신 질문]
{original_query}

[답변 생성 지침]
1.  **의도 파악 및 답변 구조화**: 먼저 [사용자의 최신 질문]이 '작물 추천'을 원하는지, 아니면 '재배 방법'과 같은 '상세 설명'을 원하는지 파악하세요. 그 의도에 맞춰 답변의 전체적인 흐름을 결정해야 합니다.
2.  **'추천' 답변**: 만약 사용자가 작물 추천을 원했다면, [검색된 참고 정보]를 바탕으로 조건에 맞는 작물들을 목록으로 제시하고, 각 작물이 왜 적합한지 간략히 설명하세요.
3.  **'설명' 답변**: 만약 사용자가 재배 방법 등을 물었다면, [검색된 참고 정보]에서 각 작물(예: 비트, 양파, 상추)의 재배 방법에 대한 내용을 찾아 명확하게 구분하여 설명해주세요.
4.  **자연스러운 대화**: 답변을 시작할 때, 이전 대화의 맥락을 이어받는 자연스러운 문장으로 시작하세요. (예: "네, 이전에 추천해 드렸던 작물들의 재배 방법에 대해 알려드릴게요.")
5.  **임무 집중**: 사용자가 묻지 않은 내용(예: 추천을 원하는데 재배 방법을 설명)은 먼저 언급하지 마세요.
6.  **핵심 규칙 준수**: '품종 이름'을 '작물명'으로 일반화하고, '순수 한글'만 사용하며, '마크다운 서식 금지' 규칙은 항상 지켜야 합니다.
7.  **정보 부족 시**: 특정 작물에 대한 정보가 부족하다면, "OO에 대한 정보는 찾지 못했지만, 다른 작물에 대해서는 다음과 같습니다." 와 같이 솔직하게 답변하세요.
8.  **후속 질문 제안**: 답변 마지막에, 현재 대화의 주제와 관련된 유용한 후속 질문을 제안하세요.

위 지침에 따라 최종 답변을 생성하세요.
[최종 답변]"""
    
    api_messages = [{"role": "user", "content": final_prompt}]
    chat_completion = groq_client.chat.completions.create(
        messages=api_messages, 
        model="llama-3.3-70b-versatile",
        temperature=LLM_TEMPERATURE
    )
    full_response = chat_completion.choices[0].message.content
    logger.info("최종 답변 생성 완료.")
    
    new_messages = messages + [AIMessage(content=full_response)]
    return {"messages": new_messages}

# ====[수정된 부분 1: 새로운 노드 추가]====
# 검색된 문서가 없을 경우를 처리하기 위한 간단한 노드를 추가합니다.
def handle_no_documents(state: AgentState) -> dict:
    """검색된 문서가 없을 때 간단한 답변을 생성하는 함수"""
    logger.info("--- No Documents 핸들러 실행 ---")
    response_text = "죄송하지만, 문의하신 내용과 관련된 정보를 데이터베이스에서 찾지 못했습니다. 다른 질문을 해주시겠어요?"
    new_messages = state['messages'] + [AIMessage(content=response_text)]
    return {"messages": new_messages}

# ====[수정된 부분 2: 조건부 라우터 함수 추가]====
# Retriever 노드 실행 후, 검색된 문서의 유무에 따라 다음 단계를 결정하는 함수입니다.
def should_generate(state: AgentState) -> Literal["generator", "no_docs_handler"]:
    """검색된 문서가 있는지 확인하여 다음 노드를 결정합니다."""
    logger.info("--- 라우터 실행: 문서 존재 여부 확인 ---")
    if state["documents"]:
        logger.info("결과: 문서 있음 -> Generator로 이동")
        return "generator"
    else:
        logger.info("결과: 문서 없음 -> No Documents 핸들러로 이동")
        return "no_docs_handler"

# --- 3. LangGraph 워크플로우 구축 ---
workflow = StateGraph(AgentState)
workflow.add_node("query_rewriter", rewrite_query)
workflow.add_node("retriever", retrieve_documents_hybrid)
workflow.add_node("generator", generate_final_response)
# ====[수정된 부분 3: 새로운 노드 등록]====
workflow.add_node("no_docs_handler", handle_no_documents)

workflow.set_entry_point("query_rewriter")
workflow.add_edge("query_rewriter", "retriever")

# ====[수정된 부분 4: 조건부 엣지(Conditional Edge) 설정]====
# retriever 노드 다음에 should_generate 함수를 실행하여 분기점을 만듭니다.
workflow.add_conditional_edges(
    "retriever",
    should_generate,
    {
        "generator": "generator",
        "no_docs_handler": "no_docs_handler"
    }
)
# 각 분기점의 마지막은 END로 연결합니다.
workflow.add_edge("generator", END)
workflow.add_edge("no_docs_handler", END)

rag_app = workflow.compile()

# --- 4. 챗봇 메인 로직 ---
def main():
    """작물 추천 에이전트의 메인 함수"""
    print("\n" + "="*70)
    print(" 작물 추천 전문 AI ".center(70, "="))
    print("="*70)
    print("안녕하세요! 원하시는 재배 조건(지역, 기후 등)을 알려주시면 적합한 작물을 추천해 드립니다.")
    print("대화를 종료하려면 '종료'라고 입력해주세요.")
    print("-" * 70)

    current_state = {"messages": [], "documents": [], "rewritten_query": "", "original_query": ""}

    while True:
        user_input = input("나: ")
        if user_input.lower() == '종료':
            print("\n챗봇: 대화를 종료합니다. 이용해주셔서 감사합니다.")
            break

        current_state["messages"].append(HumanMessage(content=user_input))
        
        try:
            final_state = rag_app.invoke(current_state)
            current_state = final_state
            final_bot_message = current_state["messages"][-1]

            print(f"챗봇: ", end="", flush=True)
            for char in final_bot_message.content:
                print(char, end="", flush=True)
                time.sleep(0.02)
            print()
            
            print("-" * 70)

        except RateLimitError:
            logger.warning("Groq API 사용량 제한에 도달했습니다.")
            # ... (오류 처리 부분은 동일)
        except Exception as e:
            logger.error(f"예상치 못한 오류가 발생했습니다: {e}", exc_info=True)
            print(f"\n죄송합니다, 오류가 발생하여 답변을 생성할 수 없습니다. 잠시 후 다시 시도해주세요.")

if __name__ == "__main__":
    try:
        graph_image_path = "agent_workflow.png"
        with open(graph_image_path, "wb") as f:
            f.write(rag_app.get_graph().draw_mermaid_png())
        logger.info(f"LangGraph 구조가 '{graph_image_path}' 파일로 저장되었습니다.")
    except Exception as e:
        logger.warning(f"그래프 시각화 중 오류가 발생했습니다: {e}")

    main()

