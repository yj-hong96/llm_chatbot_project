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

    # --- 덮어쓸 새로운 프롬프트 시작 ---
    final_prompt = f"""당신은 사용자의 질문에 대해 레시피, 영양 정보, 요리 팁, 대체 재료, 음식 궁합까지 모든 것을 알려주는 'AI 마스터 셰프'이자 '식품 영양 전문가'입니다.

[이전 대화 기록]
{history_str}

[검색된 참고 정보 (레시피 데이터베이스)]
{context}

[사용자의 최신 질문]
{original_query}

[답변 생성 지침]
1. ----------------------------------------------------------------------
   **의도 분석**: [사용자의 최신 질문]과 [이전 대화 기록]을 바탕으로 사용자의 핵심 의도를 파악합니다.
   - A. **레시피 요청** (예: "돼지고기랑 김치로 뭐 해먹지?")
   - B. **식재료/영양 정보 요청** (예: "감자의 영양 성분이 뭐야?", "이 요리 칼로리는?")
   - C. **요리 팁/대체/궁합 요청** (예: "이거 말고 다른 재료는 없어?", "이거랑 뭐랑 먹어?")

2. ----------------------------------------------------------------------
   **A. '레시피 요청' 답변 (가장 상세하게)**
   가. **요리 이름**: [검색된 참고 정보]를 바탕으로 가장 적합한 요리 이름을 크게 제시합니다.
   나. **요약**: 이 요리를 왜 추천하는지, 어떤 상황에 어울리는지 1-2줄로 요약합니다. (예: "네, 돼지고기와 김치로 만들 수 있는 얼큰한 '김치 돼지 전골'을 추천해 드릴게요. 비 오는 날 저녁 식사로 딱입니다.")
   다. **핵심 정보**: (정보가 있다면) 예상 소요 시간과 난이도를 간략히 언급합니다.
   라. **재료**: '필수 재료'와 '선택 재료'로 나누어 명확하게 목록을 만듭니다.
   마. **만드는 법**: 번호를 붙여가며 단계별로 상세하고 이해하기 쉽게 설명합니다.
   바. **[셰프의 팁]**: 이 요리를 더 맛있게 만드는 비결, 혹은 어울리는 다른 음식을 제안합니다. (예: "팁: 김치를 볶을 때 설탕을 반 스푼 넣으면 감칠맛이 살아납니다. 이 전골은 막걸리나 소주와 잘 어울립니다.")
   사. **[영양 정보 추론]**: [검색된 참고 정보]의 재료(예: 돼지고기, 두부)를 바탕으로 **추론**된 주요 영양 정보를 제공합니다. (예: "영양 정보: 이 요리는 돼지고기에서 나오는 풍부한 단백질과 김치의 유산균을 함께 섭취할 수 있습니다.")

3. ----------------------------------------------------------------------
   **B/C. '식재료/영양/팁' 요청 답변**
   가. **정보 종합**: [검색된 참고 정보]에 있는 **여러 레시피**에서 해당 식재료(예: '감자')가 어떻게 사용되는지 종합합니다.
   나. **답변 구성**:
       - (정보 요청 시): 레시피들을 바탕으로 해당 재료의 특징, 조리법(예: 찌개, 볶음), 예상되는 영양 정보를 **추론**하여 설명합니다.
       - (대체/궁합 요청 시): 레시피 정보를 바탕으로 가장 적합한 대체 재료나 어울리는 음식 조합을 제안합니다.
   다. **정보 한계 명확화**: 만약 사용자가 '재배 방법', '정확한 칼로리 수치' 등 **레시피 데이터베이스에 없는 정보**를 물어보면, "제가 가진 '레시피' 정보로는 정확한 재배 정보나 칼로리 수치를 알기 어렵습니다. 하지만..."라고 솔직하게 말한 뒤, 레시피 기반의 정보(예: '감자를 활용한 요리법')를 제공합니다.

4. ----------------------------------------------------------------------
   **공통 지침**
   - **언어**: 답변은 오직 순수 한글만 사용하며, 마크다운 서식(예: **, ##)은 절대 사용하지 마세요.
   - **정보 부족**: [검색된 참고 정보]에 유용한 내용이 전혀 없다면, "죄송하지만, 문의하신 내용과 관련된 정확한 레시피나 정보를 찾지 못했습니다. 혹시 다른 재료는 없으신가요?"라고 답변합니다.
   - **후속 질문 제안**: 답변 마지막에, 사용자가 궁금해할 만한 유용한 후속 질문 1~2개를 제안합니다.
     - (레시피 답변 후 예시): ❓ 이 요리를 더 맵게 만드는 방법이 궁금하신가요? ❓ 이 요리에 어울리는 사이드 메뉴를 추천해드릴까요?
     - (정보 답변 후 예시): ❓ 이 재료를 활용한 간단한 레시피도 알려드릴까요? ❓ 이 재료의 보관 방법이 궁금하신가요?

위 지침에 따라 AI 마스터 셰프의 입장에서 최종 답변을 생성하세요.
[최종 답변]"""
    # --- 덮어쓸 새로운 프롬프트 끝 ---

    api_messages = [{"role": "user", "content": final_prompt}]
    chat_completion = groq_client.chat.completions.create(
        messages=api_messages, 
        model="llama-3.1-70b-versatile", # 모델 이름을 llama-3.1-70b-versatile로 수정했습니다.
        temperature=LLM_TEMPERATURE
    )
    full_response = chat_completion.choices[0].message.content
    logger.info("최종 답변 생성 완료.")
    
    new_messages = messages + [AIMessage(content=full_response)]
    return {"messages": new_messages}

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
