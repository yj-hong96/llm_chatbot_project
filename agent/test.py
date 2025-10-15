import os
import re
import asyncio
from dotenv import load_dotenv
from groq import Groq, RateLimitError
from typing import TypedDict, List
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, BaseMessage
from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings
from pymilvus import connections, Collection
from langgraph.graph import StateGraph, END

# --- 1. 초기 설정 (이전과 동일) ---
load_dotenv()
try:
    groq_client = Groq()
except Exception as e:
    print(f"오류: Groq 클라이언트를 초기화할 수 없습니다. {e}")
    exit()

MILVUS_HOST = "localhost"
MILVUS_PORT = "19530"
COLLECTION_NAME = "farmer"
EMBEDDING_MODEL = "jhgan/ko-sroberta-multitask"
LLM_TEMPERATURE = 0.7

print("임베딩 모델을 로드합니다...")
embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)

print("Milvus에 연결하고 컬렉션을 로드합니다...")
try:
    connections.connect("default", host=MILVUS_HOST, port=MILVUS_PORT)
    farmer_collection = Collection(COLLECTION_NAME)
    farmer_collection.load()
    print("Milvus 컬렉션 로드 완료.")
except Exception as e:
    print(f"오류: Milvus 컬렉션을 로드할 수 없습니다. {e}")
    exit()

# ====[수정된 부분 1: RAG 에이전트 재설계]====
# 기존의 복잡한 '질문 분해 -> 병렬 RAG -> 답변 종합' 구조는 API 호출이 너무 많아 비효율적이었습니다.
# 이제 'DB 검색 -> 답변 생성'의 단일 RAG 파이프라인으로 단순화하여 API 호출을 단 1회로 최소화합니다.

# --- 2. LangGraph 상태 및 노드 정의 (단순화된 구조) ---

# LangGraph 에이전트의 상태를 정의합니다.
class AgentState(TypedDict):
    messages: List[BaseMessage]
    documents: List[Document]

# [노드 1: Retriever] Milvus에서 관련 문서를 검색하는 함수
def retrieve_documents(state: AgentState) -> AgentState:
    """사용자의 마지막 질문을 기반으로 Milvus에서 문서를 검색합니다."""
    print(f"\n--- Retriever 실행 (질문: '{state['messages'][-1].content[:30]}...') ---")
    last_message = state['messages'][-1]
    query_vector = embeddings.embed_query(last_message.content)
    
    search_params = {"metric_type": "L2", "params": {"nprobe": 10}}
    results = farmer_collection.search(
        data=[query_vector], 
        anns_field="vector", 
        param=search_params, 
        limit=5, # 충분한 정보를 얻기 위해 5개 문서를 검색합니다.
        output_fields=["text", "source", "page"]
    )
    
    retrieved_docs = [
        Document(
            page_content=hit.entity.get('text'), 
            metadata={"source": hit.entity.get('source'), "page": hit.entity.get('page')}
        ) for hit in results[0]
    ] if results and results[0] else []
    
    print(f"검색된 문서 {len(retrieved_docs)}개")
    return {"documents": retrieved_docs}

# [노드 2: Generator] 검색된 문서와 대화 기록을 바탕으로 최종 답변을 생성하는 함수
def generate_final_response(state: AgentState) -> AgentState:
    """
    모든 검색된 정보와 대화 기록을 종합하여, 단 한 번의 API 호출로 최종 답변을 생성합니다.
    기존의 Synthesizer 역할을 이 함수가 모두 수행합니다.
    """
    print("--- Generator 실행 (최종 답변 생성) ---")
    messages = state['messages']
    documents = state['documents']

    context = "\n\n".join([f"[출처: {doc.metadata.get('source', '알 수 없음')}, {doc.metadata.get('page', 'N/A')}페이지]\n{doc.page_content}" for doc in documents])
    history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in messages[:-1]]) # 마지막 사용자 질문 제외

    # 최종 답변 생성을 위한 강화된 프롬프트
    final_prompt = f"""당신은 친절하고 유능한 '농업 기술 전문 AI 조수'입니다. 주어진 모든 정보를 종합하여 사용자의 질문에 대한 최종 답변을 생성하는 임무를 맡았습니다.

[이전 대화 기록]
{history_str}

[새로 검색된 참고 정보]
{context}

[사용자의 최신 질문]
{messages[-1].content}

[답변 생성 지침]
1.  **품종 이름 제거 및 작물명으로 일반화 (가장 중요한 규칙)**: 답변 내용에 '설향', '금실', '유타개량' 같은 구체적인 **품종** 이름이 나온다면, **절대로 그대로 사용하지 말고** 반드시 대표 **작물** 이름인 '딸기', '셀러리' 등으로 바꿔서 설명해야 합니다. 최종 답변에는 품종 이름이 단 하나도 포함되어서는 안 됩니다.
2.  **목록화 우선**: 사용자가 "모든 종류", "다양하게" 등 목록을 요청하는 경우, [새로 검색된 참고 정보]에 언급된 모든 고유한 작물 이름을 먼저 나열한 후, 각 작물에 대한 설명을 요약하여 제공하세요.
3.  **정보 종합**: 내용을 단순히 나열하지 말고, 유기적으로 연결하고 중복을 제거하여 하나의 완성된 글로 재구성하세요.
4.  **언어 및 형식**: 답변은 **오직 순수 한글**로만 작성되어야 하며, 어떤 종류의 마크다운 서식(제목, 목록, 굵은 글씨 등)도 절대 사용해서는 안 됩니다.
5.  **근거 기반 답변**: 답변은 반드시 [새로 검색된 참고 정보]에 있는 내용만을 근거로 해야 합니다. 정보가 부족하면 "죄송하지만, 제공된 정보만으로는 해당 내용에 대해 정확히 답변하기 어렵습니다."라고 솔직하게 말해야 합니다.
6.  **지능적인 후속 질문**: 답변의 핵심 주제와 관련된 후속 질문을 한두 가지 제안하세요. 질문 앞에는 물음표 이모지(❓)를 붙여주세요.

위 지침에 따라 최종 답변을 생성하세요.

[최종 답변]"""
    
    api_messages = [{"role": "user", "content": final_prompt}]
    
    # 단일 API 호출로 최종 답변 생성
    chat_completion = groq_client.chat.completions.create(
        messages=api_messages, 
        model="llama-3.3-70b-versatile", # 답변 품질을 위해 고성능 모델 사용
        temperature=LLM_TEMPERATURE
    )
    final_answer = chat_completion.choices[0].message.content
    print("최종 답변 생성 완료.")
    
    return {"messages": [AIMessage(content=final_answer)]}

# --- 3. LangGraph 워크플로우 구축 (단순화된 구조) ---
workflow = StateGraph(AgentState)
workflow.add_node("retriever", retrieve_documents)
workflow.add_node("generator", generate_final_response) # 답변 생성 함수 변경
workflow.set_entry_point("retriever")
workflow.add_edge("retriever", "generator")
workflow.add_edge("generator", END)
rag_app = workflow.compile()


# --- 4. 챗봇 메인 로직 (단순화된 구조) ---
def main():
    """단순화된 RAG 기반 챗봇의 메인 함수"""
    print("안녕하세용 작물에 해당하는 내용 질문 해주세용^^")
    print("-" * 70)

    # 대화 기록을 저장하는 리스트 (단기 기억)
    conversation_history: List[BaseMessage] = []

    while True:
        user_input = input("나: ")
        if user_input.lower() == '종료':
            print("챗봇: 대화를 종료합니다.")
            break

        # ====[수정된 부분 2: 메인 로직 단순화]====
        # decompose_query와 synthesize_results 함수 호출을 제거하고,
        # 사용자의 입력을 바로 RAG 앱에 전달하여 단일 파이프라인으로 처리합니다.
        
        # 현재 사용자의 질문을 전체 대화 기록에 추가
        current_messages = conversation_history + [HumanMessage(content=user_input)]
        
        try:
            # LangGraph 에이전트 실행 (API 호출 1회 발생)
            final_state = rag_app.invoke({"messages": current_messages})
            
            # 에이전트의 최종 응답을 가져옴
            bot_response_message = final_state['messages'][-1]
            
            # 대화 기록에 사용자 질문과 챗봇 답변을 모두 저장
            conversation_history.append(HumanMessage(content=user_input))
            conversation_history.append(bot_response_message)

            print("\n" + "="*70)
            print(" 최종 답변 ".center(70, "="))
            print("="*70)
            print(f"챗봇: {bot_response_message.content}")
            print("-" * 70)

        except RateLimitError:
            print("\n" + "="*70)
            print("🚫 API 사용량 초과 알림 🚫".center(68))
            print("="*70)
            print("현재 Groq API의 하루 사용 가능량을 모두 소진했습니다.")
            print("\n[해결 방법]")
            print("- 잠시 후 다시 시도하시거나, 내일 API 사용량이 초기화된 후 이용해 주세요.")
            print("-" * 70)
        except Exception as e:
            print(f"오류가 발생했습니다: {e}")

if __name__ == "__main__":
    # 그래프 시각화
    try:
        graph_image_path = "agent_workflow.png"
        with open(graph_image_path, "wb") as f:
            f.write(rag_app.get_graph().draw_mermaid_png())
        print(f"\n✅ LangGraph 구조가 '{graph_image_path}' 파일로 저장되었습니다.")
    except Exception as e:
        print(f"\n[알림] 그래프 시각화 중 오류가 발생했습니다: {e}")

    # 이미지 생성 후, 챗봇의 메인 함수를 실행합니다.
    # 더 이상 복잡한 비동기 처리가 필요 없으므로 asyncio.run()을 제거하고 직접 main()을 호출합니다.
    main()

