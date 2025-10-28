# Version: 7.0 - 지능형 영양 분석 에이전트
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
# [수정] nutrient 컬렉션 전용으로 변경
COLLECTION_NAME = "nutrient" 
EMBEDDING_MODEL = "jhgan/ko-sroberta-multitask"
LLM_TEMPERATURE = 0.7

logger.info("임베딩 모델을 로드합니다...")
embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)

logger.info(f"Milvus에 연결하고 '{COLLECTION_NAME}' 컬렉션을 로드합니다...")
try:
    connections.connect("default", host=MILVUS_HOST, port=MILVUS_PORT)
    # [수정] nutrient_collection 변수 이름으로 변경
    nutrient_collection = Collection(COLLECTION_NAME)
    nutrient_collection.load()
    logger.info(f"Milvus '{COLLECTION_NAME}' 컬렉션 로드 완료.")
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
    """[수정] 대화 기록을 바탕으로 사용자의 마지막 질문을 '영양 정보' 검색용 질문으로 재작성합니다."""
    messages = state['messages']
    last_message = messages[-1]
    original_query = last_message.content
    
    if len(messages) == 1:
        logger.info("첫 질문이므로 쿼리 재작성을 건너뜁니다.")
        return {"rewritten_query": original_query, "original_query": original_query}

    history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in messages[:-1]])
    
    logger.info("\n--- Query Rewriter 실행 ---")
    # [수정] '영양 정보' 검색에 초점을 맞춘 프롬프트
    rewrite_prompt = f"""당신은 사용자의 질문과 대화 기록을 분석하여, '식품 영양 성분' 검색에 가장 적합한 '검색용 질문'을 생성하는 영양사입니다.

[대화 기록]
{history_str}

[사용자의 최신 질문]
{original_query}

[지침]
1.  **의도 파악**: 사용자의 최신 질문이 특정 '식품'의 '영양 성분(칼로리, 단백질, 지방, 비타민 등)'을 궁금해하는 것인지 파악하세요.
2.  **'영양 성분' 검색 질문 생성**:
    - 질문에서 '감자', '닭가슴살'과 같은 핵심 식품명과 '칼로리', '단백질 함량' 같은 분석 키워드를 모두 찾아내세요.
    - "감자 100g당 영양 성분", "닭가슴살 단백질 함량"과 같이 구체적인 검색 질문을 만드세요.
3.  **출력 형식 엄수**: 최종 결과는 오직 재작성된 '검색용 질문' 한 줄이어야 합니다.

[예시 1: 특정 성분 요청]
- 사용자 질문: 감자 칼로리 몇이야?
- 재작성된 검색용 질문: 감자 칼로리 및 영양 성분

[예시 2: 대화형 요청]
- 이전 대화: 챗봇: ...닭가슴살을 추천합니다.
- 사용자 질문: 그거 단백질 많아?
- 재작성된 검색용 질문: 닭가슴살 단백질 함량 및 영양 성분

[주의]
- '레시피'나 '요리법' 관련 질문이 들어와도 무조건 '영양 성분' 검색 질문으로 바꿔야 합니다.
- 예: "닭가슴살 요리" -> "닭가슴살 영양 성분"

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
    """[수정] 재작성된 질문을 기반으로 'nutrient' 컬렉션에서 하이브리드 검색을 수행합니다."""
    rewritten_query = state['rewritten_query']
    logger.info(f"\n--- Retriever 실행 (검색 질문: '{rewritten_query[:50]}...') ---")
    
    query_vector = embeddings.embed_query(rewritten_query)
    search_params = {"metric_type": "L2", "params": {"nprobe": 10}}
    
    # [수정] nutrient_collection에서 검색
    vector_results = nutrient_collection.search(data=[query_vector], anns_field="vector", param=search_params, limit=5, output_fields=["text", "source", "page"])
    
    keywords = re.split(r'\s|또는', rewritten_query)
    keyword_results = []
    if keywords:
        safe_keywords = [re.sub(r'[^가-힣\w]', '', kw) for kw in keywords if kw]
        if safe_keywords:
            keyword_expr = " or ".join([f"text like '%{keyword}%'" for keyword in safe_keywords])
            # [수정] nutrient_collection에서 쿼리
            keyword_results = nutrient_collection.query(expr=keyword_expr, limit=5, output_fields=["text", "source", "page"])
            
    all_hits = (vector_results[0] if vector_results and vector_results[0] else []) + keyword_results
    unique_docs = {}
    for hit in all_hits:
        doc_content = hit.get('text') if isinstance(hit, dict) else hit.entity.get('text')
        if doc_content not in unique_docs:
            source = hit.get('source') if isinstance(hit, dict) else hit.entity.get('source')
            page = hit.get('page') if isinstance(hit, dict) else hit.entity.get('page')
            # [수정] 메타데이터에 'collection' 명시
            unique_docs[doc_content] = Document(page_content=doc_content, metadata={"source": source, "page": page, "collection": COLLECTION_NAME})
            
    retrieved_docs = list(unique_docs.values())
    logger.info(f"최종 검색된 고유 문서 {len(retrieved_docs)}개")
    return {"documents": retrieved_docs}

def generate_final_response(state: AgentState) -> dict:
    """[수정] 'AI 식품 영양 전문가'로서 영양 성분 분석 답변을 생성합니다."""
    logger.info("--- Generator 실행 (영양 분석 답변 생성) ---")
    messages = state['messages']
    documents = state['documents']
    original_query = state['original_query']
    
    # [수정] context 생성 시 'collection' 메타데이터 포함
    context_parts = []
    for doc in documents:
        source = doc.metadata.get('source', '알 수 없음')
        collection = doc.metadata.get('collection', 'nutrient') # nutrient 고정
        page = doc.metadata.get('page', 0)
        
        source_info = f"{collection} / {source}"
        if page > 0 and not source.lower().endswith(('.csv', '.xls', '.xlsx')):
             source_info += f" (p.{page})"
        elif page > 0:
             source_info += f" (row.{page})"
            
        context_parts.append(f"[출처: {source_info}]\n{doc.page_content}")
    context = "\n\n".join(context_parts)

    history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in messages[:-1]])

    # [수정] '영양 전문가' 페르소나에 맞춘 새로운 프롬프트
    final_prompt = f"""당신은 사용자의 질문에 대해 식품의 영양 성분, 칼로리, 건강 효과를 정확하게 분석해주는 'AI 식품 영양 전문가'입니다.

[이전 대화 기록]
{history_str}

[검색된 참고 정보 (영양 성분 데이터베이스)]
{context}

[사용자의 최신 질문]
{original_query}

[답변 생성 지침]
1. ----------------------------------------------------------------------
   **페르소나 엄수**: 당신은 '영양사'이며 '셰프'가 아닙니다. 오직 영양학적 사실에 기반하여 답변해야 합니다.
2.  **핵심 의도 파악**: 사용자가 궁금해하는 핵심 식품(예: 감자)과 영양소(예: 칼로리, 단백질)를 파악합니다.
3.  **답변 구조화 (영양 분석)**:
   가. **제목**: "OOO의 영양 성분 분석" (예: "감자 100g당 영양 성분 분석")
   나. **핵심 요약**: [검색된 참고 정보]를 바탕으로 사용자가 가장 궁금해하는 수치(예: 칼로리)를 먼저 제시합니다.
   다. **주요 영양 성분**: [검색된 참고 정보]에 있는 데이터를 바탕으로 '칼로리', '탄수화물', '단백질', '지방'을 명확하게 목록으로 제시합니다.
   라. **주요 비타민 및 무기질**: [검색된 참고 정보]에 있다면 '비타민 C', '칼륨' 등 주요 미량 영양소를 언급합니다.
   마. **영양학적 코멘트**: 이 식품이 건강에 어떤 이점이 있는지(예: "식이섬유가 풍부하여 포만감을 주며..."), 혹은 주의할 점이 있는지(예: "GI 지수가 높아...") 간략하게 설명합니다.
4.  **정보 한계 명확화 (매우 중요)**:
   - **레시피/요리법 제공 절대 불가**: 만약 사용자가 '요리법', '레시피', '만드는 법' 등을 물어보면, "죄송하지만, 저는 '레시피'나 '요리법'은 알려드릴 수 없습니다. 대신 해당 재료의 '영양 성분'은 자세히 분석해 드릴 수 있습니다."라고 명확하게 선을 그어야 합니다.
   - **정보 부족 시**: [검색된 참고 정보]에 요청한 내용(예: 특정 비타민)이 없다면, "문의하신 OOO에 대한 정확한 정보는 현재 데이터베이스에 없습니다."라고 솔직하게 답변합니다.
5.  **언어 및 형식**: 답변은 오직 순수 한글만 사용하며, 마크다운 서식(예: **, ##)은 절대 사용하지 마세요.
6.  **후속 질문 제안**: 답변 마지막에, 영양 정보와 관련된 유용한 후속 질문 1~2개를 제안합니다.
   - (예시): ❓ 이 식품과 영양학적으로 비슷한 다른 식품이 궁금하신가요? ❓ 이 식품의 당 함량이나 나트륨 정보도 알려드릴까요?

위 지침에 따라 AI 식품 영영 전문가의 입장에서 최종 답변을 생성하세요.
[최종 답변]"""
    # --- 덮어쓸 새로운 프롬프트 끝 ---

    api_messages = [{"role": "user", "content": final_prompt}]
    chat_completion = groq_client.chat.completions.create(
        messages=api_messages, 
        model="llama-3.1-70b-versatile",
        temperature=LLM_TEMPERATURE
    )
    full_response = chat_completion.choices[0].message.content
    logger.info("최종 답변 생성 완료.")
    
    new_messages = messages + [AIMessage(content=full_response)]
    return {"messages": new_messages}


def handle_no_documents(state: AgentState) -> dict:
    """검색된 문서가 없을 때 간단한 답변을 생성하는 함수"""
    logger.info("--- No Documents 핸들러 실행 ---")
    # [수정] '영양 정보'에 맞게 문구 변경
    response_text = "죄송하지만, 문의하신 내용과 관련된 정확한 영양 정보를 데이터베이스에서 찾지 못했습니다. 다른 식품명으로 다시 질문해주시겠어요?"
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
    """[수정] 영양 분석 에이전트의 메인 함수"""
    print("\n" + "="*70)
    # [수정] 페르소나 변경
    print(" AI 식품 영양 전문가 ".center(70, "="))
    print("="*70)
    # [수정] 안내 문구 변경
    print("안녕하세요! 식품의 영양 성분, 칼로리 등 궁금한 점을 무엇이든 물어보세요.")
    print("('레시피'나 '요리법' 문의는 답변이 어렵습니다.)")
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
            print("\n챗봇: API 사용량 제한에 도달했습니다. 잠시 후 다시 시도해주세요.")
            current_state["messages"].pop() # 실패한 입력 롤백
            
        except Exception as e:
            logger.error(f"예상치 못한 오류가 발생했습니다: {e}", exc_info=True)
            print(f"\n죄송합니다, 오류가 발생하여 답변을 생성할 수 없습니다. 잠시 후 다시 시도해주세요.")
            if current_state["messages"]:
                current_state["messages"].pop() # 실패한 입력 롤백

if __name__ == "__main__": # 스크립트가 직접 실행될 때만 아래 코드 실행
    # 1) 워크플로우 시각화 PNG 파일 생성
    if rag_app: # 그래프 객체가 성공적으로 생성되었는지 확인
         try:
              graph_image_path = f"{COLLECTION_NAME}_workflow.png" # 저장할 이미지 파일명
              # 그래프 구조를 Mermaid 형식으로 그려 PNG 파일로 저장
              with open(graph_image_path, "wb") as f:
                   f.write(rag_app.get_graph().draw_mermaid_png())
              logger.info(f"LangGraph 구조가 '{graph_image_path}' 파일로 저장되었습니다.") # 성공 로그
         except Exception as e:
              # 시각화 중 오류 발생 시 경고 로그
              logger.warning(f"그래프 시각화 중 오류가 발생했습니다: {e}")
    else:
         # 그래프 객체 생성 실패 시 시각화 건너뛰기 로그
         logger.warning("워크플로우 객체(rag_app)가 없어 시각화를 건너<0xEB><0x9A><0x8E>니다.")

    # 2) 실제 데이터 처리 및 저장 작업 실행
    main() # 메인 실행 함수 호출