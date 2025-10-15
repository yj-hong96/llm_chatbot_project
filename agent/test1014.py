# Version: 4.7 - 지능형 대화 흐름 및 자동 종합 추천 기능 강화
import os
import re
import time
import asyncio
import logging
from dotenv import load_dotenv
from groq import Groq, RateLimitError
from typing import TypedDict, List
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

def rewrite_query(state: AgentState) -> AgentState:
    """대화 기록을 바탕으로 사용자의 마지막 질문을 '작물 추천'에 적합한 검색용 질문으로 재작성합니다."""
    messages = state['messages']
    last_message = messages[-1].content
    
    if len(messages) <= 1:
        logger.info("첫 질문이므로 쿼리 재작성을 건너뜁니다.")
        return state

    history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in messages[:-1]])
    
    logger.info("\n--- Query Rewriter 실행 ---")
    rewrite_prompt = f"""당신은 사용자의 질문과 대화 기록을 종합하여, 단 하나의 완벽한 검색용 질문으로 재작성하는 전문가입니다.

[대화 기록]
{history_str}

[사용자의 마지막 질문]
{last_message}

[지침]
1.  **핵심 조건 파악**: [대화 기록]에서 사용자가 원하는 핵심 추천 조건(예: '고랭지 지역')을 찾아내세요.
2.  **모든 작물 종합**: [대화 기록]과 [사용자의 마지막 질문]에서 언급된 모든 작물 이름(예: 셀러리, 고구마, 감자)을 빠짐없이 찾아내세요.
3.  **최종 질문 생성**: 위에서 파악한 '핵심 조건'과 '모든 작물'을 결합하여, "고랭지 지역에 셀러리, 고구마, 감자를 포함하여 추천해줘"와 같이 모든 내용을 포괄하는 단 하나의 검색 질문을 만드세요.
4.  **[매우 중요]** 최종 결과는 오직 재작성된 '질문' 한 줄이어야 합니다. 다른 부가적인 설명을 절대 추가하지 마세요.

[재작성 예시]
- 이전 대화: 고랭지 작물로 셀러리를 추천함.
- 사용자 질문: 감자는 어때?
- 재작성된 검색용 질문: 고랭지 지역에 셀러리와 감자를 포함하여 추천해줘

[실제 재작성 작업]
[재작성된 검색용 질문]"""

    try:
        chat_completion = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": rewrite_prompt}],
            model="llama-3.1-8b-instant",
            temperature=0.0
        )
        rewritten_query = chat_completion.choices[0].message.content.strip()

        if len(rewritten_query) > 100 or not re.match(r'^[가-힣\s\w\?\,]+$', rewritten_query):
            logger.warning(f"재작성된 쿼리가 비정상적으로 보입니다. 원본 질문을 사용합니다. (결과: {rewritten_query})")
            rewritten_query = last_message
        
        logger.info(f"재작성된 질문: {rewritten_query}")
        updated_messages = messages[:-1] + [HumanMessage(content=rewritten_query)]
        return {"messages": updated_messages}
    except Exception as e:
        logger.error(f"쿼리 재작성 중 오류 발생: {e}")
        return state

def retrieve_documents_hybrid(state: AgentState) -> AgentState:
    """[하이브리드 검색] 벡터 검색과 키워드 검색을 모두 수행하여 문서를 검색합니다."""
    rewritten_message = state['messages'][-1].content
    logger.info(f"\n--- Retriever 실행 (재작성된 질문: '{rewritten_message[:30]}...') ---")
    
    logger.info("1. 벡터(의미) 검색을 수행합니다...")
    query_vector = embeddings.embed_query(rewritten_message)
    search_params = {"metric_type": "L2", "params": {"nprobe": 10}}
    vector_results = farmer_collection.search(data=[query_vector], anns_field="vector", param=search_params, limit=5, output_fields=["text", "source", "page"])
    
    logger.info("2. 키워드 검색을 수행합니다...")
    keywords = rewritten_message.split()
    keyword_results = []
    if keywords:
        safe_keywords = [re.sub(r'[^가-힣\w]', '', kw) for kw in keywords if kw]
        if safe_keywords:
            keyword_expr = " or ".join([f"text like '%{keyword}%'" for keyword in safe_keywords])
            keyword_results = farmer_collection.query(expr=keyword_expr, limit=5, output_fields=["text", "source", "page"])

    logger.info("3. 검색 결과를 종합하고 중복을 제거합니다.")
    all_hits = (vector_results[0] if vector_results and vector_results[0] else []) + keyword_results
    
    unique_docs = {}
    for hit in all_hits:
        doc_content = hit.get('text') if isinstance(hit, dict) else hit.entity.get('text')
        if doc_content not in unique_docs:
            source = hit.get('source') if isinstance(hit, dict) else hit.entity.get('source')
            page = hit.get('page') if isinstance(hit, dict) else hit.entity.get('page')
            unique_docs[doc_content] = Document(page_content=doc_content, metadata={"source": source, "page": page})

    retrieved_docs = list(unique_docs.values())
    
    logger.info("--- 검색된 문서 내용 ---")
    for i, doc in enumerate(retrieved_docs):
        logger.info(f"  [문서 {i+1}] {doc.page_content[:150]}...")
    logger.info("------------------------")
    logger.info(f"최종 검색된 고유 문서 {len(retrieved_docs)}개")
    return {"documents": retrieved_docs}

def generate_recommendation_response(state: AgentState) -> dict:
    """오직 '작물 추천'에만 집중하여 최종 답변을 생성합니다."""
    logger.info("--- Generator 실행 (작물 추천 답변 생성) ---")
    messages = state['messages']
    documents = state['documents']

    context = "\n\n".join([f"[출처: {doc.metadata.get('source', '알 수 없음')}, {doc.metadata.get('page', 'N/A')}페이지]\n{doc.page_content}" for doc in documents])
    original_user_question = next(msg for msg in reversed(messages) if isinstance(msg, HumanMessage))
    history_without_rewritten = [msg for msg in messages if msg != state['messages'][-1]] + [original_user_question]
    history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in history_without_rewritten[:-1]])

    final_prompt = f"""당신은 사용자의 질문에 맞춰, 검색된 정보를 바탕으로 종합적인 작물 추천 답변을 생성하는 '작물 추천 전문 AI'입니다.

[이전 대화 기록]
{history_str}

[검색된 참고 정보]
{context}

[사용자의 최신 질문]
{original_user_question.content}

[답변 생성 지침]
1.  **대화 시작 (가장 중요)**: 사용자의 최신 질문 의도를 파악하고, 그에 맞는 자연스러운 문장으로 답변을 시작하세요.
    - **만약 사용자가 특정 작물에 대해 물었다면 (예: "배추는 어때요?"):** "네, 문의하신 배추에 대한 정보와 함께 이전에 추천드렸던 작물들을 종합해서 다시 알려드릴게요." 와 같이 대화를 시작하세요.
    - **만약 사용자가 일반적인 추천을 요청했다면 (예: "다른 것도 추천해줘"):** "네, 다른 작물들에 대한 정보도 함께 알려드릴게요." 와 같이 시작하세요.
    - **만약 첫 질문이라면:** 바로 아래 2번 지침에 따라 추천 목록을 만드세요.

2.  **종합 추천 목록 생성**: [검색된 참고 정보]를 바탕으로, 현재 대화의 조건(예: '고랭지')에 맞는 모든 작물(예: 셀러리, 감자, 배추)의 추천 목록을 만드세요.

3.  **목록 형식**: 추천하는 작물들의 이름을 먼저 나열한 후, 각 작물이 왜 해당 조건에 적합한지에 대한 이유를 [검색된 참고 정보]를 근거로 한두 문장으로 요약하여 설명하세요.

4.  **임무 집중**: 당신의 역할은 오직 '작물 추천'입니다. 재배 방법, 병해충 관리 등 추천과 직접 관련 없는 상세 정보는 절대 먼저 언급하지 마세요.

5.  **작물 이름 일반화**: 답변에 '유타개량 15호'와 같은 구체적인 **품종** 이름이 나온다면, 반드시 대표 **작물** 이름인 '셀러리' 등으로 바꿔서 설명해야 합니다.

6.  **언어 및 형식**: 답변은 오직 순수 한글로만 작성해야 하며, 마크다운 서식은 절대 사용해서는 안 됩니다.

7.  **정보 부족 시**: 만약 [검색된 참고 정보]에 특정 작물에 대한 정보가 없다면, 그 작물은 목록에 포함하되 "해당 작물은 정보가 부족하여 추천 여부를 판단하기 어렵습니다."라고 솔직하게 명시하세요.

8.  **후속 질문 제안 (고도화)**: 답변 마지막에, 더 정확한 추천을 위해 필요한 추가 정보를 묻는 구체적이고 친절한 질문을 한두 가지 제안하세요.
    - (좋은 예시): ❓ 혹시 밭의 토양이 물이 잘 빠지는 편인가요, 아니면 진흙처럼 물을 오래 머금는 편인가요?
    - (좋은 예시): ❓ 하루 중 햇볕이 얼마나 드는지(예: 하루 종일, 반나절)도 알려주시면 추천의 정확도를 높일 수 있습니다.

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
    
    return {"messages": [AIMessage(content=full_response)]}

# --- 3. LangGraph 워크플로우 구축 ---
workflow = StateGraph(AgentState)
workflow.add_node("query_rewriter", rewrite_query)
workflow.add_node("retriever", retrieve_documents_hybrid)
workflow.add_node("generator", generate_recommendation_response)

workflow.set_entry_point("query_rewriter")
workflow.add_edge("query_rewriter", "retriever")
workflow.add_edge("retriever", "generator")
workflow.add_edge("generator", END)

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

    conversation_history: List[BaseMessage] = []

    while True:
        user_input = input("나: ")
        if user_input.lower() == '종료':
            print("\n챗봇: 대화를 종료합니다. 이용해주셔서 감사합니다.")
            break

        current_messages = conversation_history + [HumanMessage(content=user_input)]
        
        try:
            original_human_message = HumanMessage(content=user_input)

            final_state = rag_app.invoke({"messages": current_messages})
            final_bot_message = final_state["messages"][-1]

            print(f"챗봇: ", end="", flush=True)
            for char in final_bot_message.content:
                print(char, end="", flush=True)
                time.sleep(0.02)
            print()

            conversation_history.append(original_human_message)
            conversation_history.append(final_bot_message)
            
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

