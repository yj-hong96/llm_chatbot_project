import os
from dotenv import load_dotenv
from groq import Groq
from typing import TypedDict, List
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, BaseMessage
from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings
from pymilvus import connections, Collection
from langgraph.graph import StateGraph, END

# --- 1. 초기 설정: 환경변수, API 클라이언트, Milvus, 임베딩 ---

# .env 파일에서 환경 변수를 로드합니다.
load_dotenv()

# Groq 클라이언트 초기화
try:
    groq_client = Groq()
except Exception as e:
    print(f"오류: Groq 클라이언트를 초기화할 수 없습니다. {e}")
    exit()

# Milvus 및 임베딩 모델 설정
MILVUS_HOST = "localhost"
MILVUS_PORT = "19530"
COLLECTION_NAME = "farmer"  # 사용할 컬렉션 이름
EMBEDDING_MODEL = "jhgan/ko-sroberta-multitask"
LLM_TEMPERATURE = 0.7  # LLM의 응답 창의성 조절 (0.0 ~ 2.0)

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
    print(f"'{COLLECTION_NAME}' 컬렉션이 존재하는지, Milvus 서버가 실행 중인지 확인하세요.")
    exit()

# --- 2. LangGraph 상태 및 노드 정의 ---

# LangGraph 에이전트의 상태를 정의합니다. (대화 기록 + 검색된 문서)
class AgentState(TypedDict):
    messages: List[BaseMessage]
    documents: List[Document]

# [노드 1: Retriever] Milvus에서 관련 문서를 검색하는 함수
def retrieve_documents(state: AgentState) -> AgentState:
    """사용자의 마지막 질문을 기반으로 Milvus에서 문서를 검색합니다."""
    print("\n--- Retriever 노드 실행 ---")
    last_message = state['messages'][-1]
    query_vector = embeddings.embed_query(last_message.content)

    # Milvus에서 유사도 검색 수행
    search_params = {"metric_type": "L2", "params": {"nprobe": 10}}
    results = farmer_collection.search(
        data=[query_vector],
        anns_field="vector",
        param=search_params,
        limit=3,  # 상위 3개 결과 가져오기
        output_fields=["text"]
    )
    
    retrieved_docs = []
    if results and results[0]:
        for hit in results[0]:
            retrieved_docs.append(Document(page_content=hit.entity.get('text')))
    
    print(f"검색된 문서 {len(retrieved_docs)}개")
    return {"documents": retrieved_docs}

# [노드 2: Generator] 검색된 문서를 바탕으로 LLM 답변을 생성하는 함수
def generate_response(state: AgentState) -> AgentState:
    """검색된 문서와 대화 기록을 바탕으로 최종 답변을 생성합니다."""
    print("--- Generator 노드 실행 ---")
    messages = state['messages']
    documents = state['documents']

    # LLM에게 전달할 프롬프트 재구성 (규칙 강화)
    context = "\n\n".join([doc.page_content for doc in documents])
    prompt_template = f"""당신은 다음의 엄격한 규칙을 따르는 농업 전문가입니다.

[규칙]
1.  **언어 제한**: 답변은 반드시 순수한 한국어로만 작성해야 합니다. 영어, 한자, 일본어 등 외국어나 불필요한 외래어는 절대 사용하지 마세요.
2.  **정보 제한**: 답변은 반드시 아래 제공된 '[참고 정보]'에 있는 내용만을 근거로 해야 합니다. 참고 정보에 내용이 없다면, "제공된 정보에는 해당 내용이 없습니다."라고만 답변하세요. 절대 당신의 기존 지식을 사용해서는 안 됩니다.

[참고 정보]
{context}

[사용자 질문]
{messages[-1].content}

[답변]
"""
    
    api_messages = [{"role": "user", "content": prompt_template}]

    chat_completion = groq_client.chat.completions.create(
        messages=api_messages,
        model="llama-3.3-70b-versatile",
        temperature=LLM_TEMPERATURE
    )
    bot_response_content = chat_completion.choices[0].message.content
    
    return {"messages": [AIMessage(content=bot_response_content)]}

# --- 3. LangGraph 워크플로우 구축 ---

workflow = StateGraph(AgentState)
workflow.add_node("retriever", retrieve_documents)
workflow.add_node("generator", generate_response)

workflow.set_entry_point("retriever")
workflow.add_edge("retriever", "generator")
workflow.add_edge("generator", END)

agent_app = workflow.compile()


# --- 4. 챗봇 메인 로직 ---

def main():
    """대화형 챗봇의 메인 함수"""
    print("\nGroq RAG 챗봇에 오신 것을 환영합니다! '종료'를 입력하면 대화가 끝납니다.")
    print("-" * 70)

    # 초기 시스템 메시지는 실제 LLM 호출 시 프롬프트 템플릿 안에서 처리됩니다.
    messages: List[BaseMessage] = []

    while True:
        user_input = input("나: ")
        if user_input.lower() == '종료':
            print("챗봇: 대화를 종료합니다.")
            break
        
        # 이전 대화 기록에 사용자 메시지 추가
        messages.append(HumanMessage(content=user_input))

        try:
            # LangGraph 에이전트 실행
            final_state = agent_app.invoke({"messages": messages})
            
            # 에이전트의 마지막 응답을 가져옴
            bot_response_message = final_state['messages'][-1]
            print(f"챗봇: {bot_response_message.content}")

            # 전체 대화 기록에 AI의 응답 추가
            messages.append(bot_response_message)
        except Exception as e:
            print(f"오류가 발생했습니다: {e}")
            messages.pop()

if __name__ == "__main__":
    # 그래프 시각화
    try:
        graph_image_path = "agent_workflow.png"
        with open(graph_image_path, "wb") as f:
            f.write(agent_app.get_graph().draw_mermaid_png())
        print(f"\n:흰색_확인_표시: LangGraph 구조가 '{graph_image_path}' 파일로 저장되었습니다.")
    except Exception as e:
        # 오류 발생 시, 라이브러리의 영어 메시지 대신 직접 작성한 한글 메시지를 출력합니다.
        print(f"\n[알림] 워크플로우 다이어그램 생성에 실패했습니다 (외부 API 접속 오류).")
        print(f"챗봇의 핵심 기능에는 영향을 주지 않으므로, 그대로 사용하시면 됩니다.")
    
    # 챗봇의 메인 함수를 실행합니다.
    main()

