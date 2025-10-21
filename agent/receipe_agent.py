# Version: 6.0 - 지능형 레시피 추천 에이전트
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
COLLECTION_NAME = "receipe" # 컬렉션 이름을 레시피로 변경
EMBEDDING_MODEL = "jhgan/ko-sroberta-multitask"
LLM_TEMPERATURE = 0.7

logger.info("임베딩 모델을 로드합니다...")
embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)

logger.info("Milvus에 연결하고 컬렉션을 로드합니다...")
try:
    connections.connect("default", host=MILVUS_HOST, port=MILVUS_PORT)
    recipe_collection = Collection(COLLECTION_NAME)
    recipe_collection.load()
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
    rewrite_prompt = f"""당신은 사용자의 질문과 대화 기록을 분석하여, '레시피' 또는 '식재료 정보' 검색에 가장 적합한 '검색용 질문'을 생성하는 전문가입니다.

[대화 기록]
{history_str}

[사용자의 최신 질문]
{original_query}

[지침]
1.  **의도 파악**: 사용자의 최신 질문이 '레시피'를 찾는 것인지, 아니면 특정 '식재료'에 대한 정보를 원하는 것인지 파악하세요.
2.  **'레시피' 검색 질문 생성**:
    - 질문에서 '돼지고기', '김치'와 같은 핵심 재료를 모두 찾아내세요.
    - 재료들을 조합하여 "돼지고기와 김치를 사용한 요리 레시피"와 같이 구체적인 검색 질문을 만드세요.
3.  **'식재료 정보' 검색 질문 생성**:
    - 질문에서 '감자', '고랭지'와 같은 핵심 작물과 조건을 찾아내세요.
    - "고랭지에서 감자 재배"와 같이 명확한 정보 검색 질문을 만드세요.
4.  **출력 형식 엄수**: 최종 결과는 오직 재작성된 '검색용 질문' 한 줄이어야 합니다.

[예시 1: 레시피 요청]
- 사용자 질문: 돼지고기랑 김치 있는데 뭐 해먹지?
- 재작성된 검색용 질문: 돼지고기와 김치를 사용한 요리 레시피

[예시 2: 식재료 정보 요청]
- 이전 대화: 챗봇: ...감자를 추천합니다.
- 사용자 질문: 어떻게 키워?
- 재작성된 검색용 질문: 감자 재배 방법

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
    vector_results = recipe_collection.search(data=[query_vector], anns_field="vector", param=search_params, limit=5, output_fields=["text", "source", "page"])
    keywords = re.split(r'\s|또는', rewritten_query)
    keyword_results = []
    if keywords:
        safe_keywords = [re.sub(r'[^가-힣\w]', '', kw) for kw in keywords if kw]
        if safe_keywords:
            keyword_expr = " or ".join([f"text like '%{keyword}%'" for keyword in safe_keywords])
            keyword_results = recipe_collection.query(expr=keyword_expr, limit=5, output_fields=["text", "source", "page"])
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
    context = "\n\n".join([f"[출처: {doc.metadata.get('source', '알 수 없음')}]\n{doc.page_content}" for doc in documents])
    history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in messages[:-1]])

    final_prompt = f"""당신은 사용자의 재료와 상황에 맞춰 완벽한 레시피를 추천하거나 식재료 정보를 알려주는 'AI 셰프'입니다.

[이전 대화 기록]
{history_str}

[검색된 참고 정보]
{context}

[사용자의 최신 질문]
{original_query}

[답변 생성 지침]
1.  **의도 파악 및 답변 구조화**: 먼저 [사용자의 최신 질문]이 '레시피'를 원하는지, 아니면 '식재료 정보'를 원하는지 파악하세요.
2.  **'레시피' 답변**:
    - [검색된 참고 정보]를 바탕으로 추천할 요리 이름을 먼저 제시하세요.
    - 그 다음, '재료'와 '만드는 법'을 명확하게 구분하여 단계별로 설명해주세요.
3.  **'식재료 정보' 답변**:
    - [검색된 참고 정보]를 바탕으로 해당 식재료의 특징, 재배 환경, 영양 정보 등을 종합하여 설명해주세요.
4.  **자연스러운 대화**: 답변을 시작할 때, 이전 대화의 맥락을 이어받는 자연스러운 문장으로 시작하세요. (예: "네, 돼지고기와 김치로 만들 수 있는 맛있는 요리를 알려드릴게요.")
5.  **언어 및 형식**: 답변은 오직 순수 한글만 사용하며, 마크다운 서식은 사용하지 마세요.
6.  **정보 부족 시**: 요청한 내용에 대한 정보가 부족하다면, "죄송하지만, 문의하신 내용과 관련된 정확한 레시피를 찾지 못했습니다."라고 솔직하게 답변하세요.
7.  **후속 질문 제안**: 답변 마지막에, 사용자가 궁금해할 만한 유용한 후속 질문을 제안하세요.
    - (레시피 답변 후 예시): ❓ 혹시 매운 음식은 괜찮으신가요? 다른 버전의 레시피도 찾아드릴까요?
    - (식재료 답변 후 예시): ❓ 이 재료를 활용한 간단한 요리 레시피도 알려드릴까요?

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

def handle_no_documents(state: AgentState) -> dict:
    """검색된 문서가 없을 때 간단한 답변을 생성하는 함수"""
    logger.info("--- No Documents 핸들러 실행 ---")
    response_text = "죄송하지만, 문의하신 내용과 관련된 레시피나 정보를 데이터베이스에서 찾지 못했습니다. 다른 재료로 다시 질문해주시겠어요?"
    new_messages = state['messages'] + [AIMessage(content=response_text)]
    return {"messages": new_messages}

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
workflow.add_node("no_docs_handler", handle_no_documents)

workflow.set_entry_point("query_rewriter")
workflow.add_edge("query_rewriter", "retriever")

workflow.add_conditional_edges(
    "retriever",
    should_generate,
    {
        "generator": "generator",
        "no_docs_handler": "no_docs_handler"
    }
)
workflow.add_edge("generator", END)
workflow.add_edge("no_docs_handler", END)

rag_app = workflow.compile()

# --- 4. 챗봇 메인 로직 ---
def main():
    """레시피 추천 에이전트의 메인 함수"""
    print("\n" + "="*70)
    print(" AI 셰프 & 농업 전문가 ".center(70, "="))
    print("="*70)
    print("안녕하세요! 가지고 계신 재료나 궁금한 작물을 알려주시면 레시피나 정보를 찾아드립니다.")
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
        graph_image_path = "receipe_graph.png"
        with open(graph_image_path, "wb") as f:
            f.write(rag_app.get_graph().draw_mermaid_png())
        logger.info(f"LangGraph 구조가 '{graph_image_path}' 파일로 저장되었습니다.")
    except Exception as e:
        logger.warning(f"그래프 시각화 중 오류가 발생했습니다: {e}")

    main()
