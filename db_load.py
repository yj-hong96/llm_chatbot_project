import os
import re
import asyncio
from dotenv import load_dotenv
from groq import Groq
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

# --- 2. LangGraph RAG 에이전트 정의 (단일 질문 처리용) ---
class AgentState(TypedDict):
    messages: List[BaseMessage]
    documents: List[Document]

def retrieve_documents(state: AgentState) -> AgentState:
    print(f"--- Retriever 실행 (질문: '{state['messages'][-1].content[:30]}...') ---")
    last_message = state['messages'][-1]
    query_vector = embeddings.embed_query(last_message.content)
    search_params = {"metric_type": "L2", "params": {"nprobe": 10}}
    results = farmer_collection.search(data=[query_vector], anns_field="vector", param=search_params, limit=3, output_fields=["text"])
    retrieved_docs = [Document(page_content=hit.entity.get('text')) for hit in results[0]] if results and results[0] else []
    return {"documents": retrieved_docs}

def generate_response(state: AgentState) -> AgentState:
    print(f"--- Generator 실행 ---")
    context = "\n\n".join([doc.page_content for doc in state['documents']])
    system_prompt = "당신은 주어진 [참고 정보]만을 바탕으로 질문에 답변하는 농업 전문가입니다. 정보가 없으면 '제공된 정보에는 해당 내용이 없습니다.'라고만 답변하세요. 답변은 반드시 한국어로 작성해야 합니다."
    user_prompt = f"[참고 정보]\n{context}\n\n[질문]\n{state['messages'][-1].content}"
    api_messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]
    chat_completion = groq_client.chat.completions.create(messages=api_messages, model="llama-3.3-70b-versatile", temperature=LLM_TEMPERATURE)
    bot_response_content = chat_completion.choices[0].message.content
    return {"messages": [AIMessage(content=bot_response_content)]}

def clean_markdown(text: str) -> str:
    """LLM이 생성한 마크다운 서식을 제거하는 함수"""
    text = re.sub(r'#+\s*', '', text)
    text = re.sub(r'^\s*[\*\-]\s*|\s*\d+\.\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'\*\*', '', text)
    return text.strip()

workflow = StateGraph(AgentState)
workflow.add_node("retriever", retrieve_documents)
workflow.add_node("generator", generate_response)
workflow.set_entry_point("retriever")
workflow.add_edge("retriever", "generator")
workflow.add_edge("generator", END)
rag_app = workflow.compile()


# --- 3. 질문 분해 및 종합을 위한 함수들 ---

# [숏텀 메모리 추가] 1. 질문 분해기에 대화 기록(history) 파라미터 추가
def decompose_query(user_query: str, history: List[BaseMessage]) -> List[str]:
    """사용자의 복잡한 질문을 검색에 용이한 여러 개의 하위 질문으로 분해합니다."""
    print("\n--- Decomposer 노드 실행 ---")
    
    # [숏텀 메모리 추가] 대화 기록을 프롬프트에 포함시키기 위해 문자열로 변환
    history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in history])

    decomposer_prompt = f"""당신은 사용자의 질문을 검색용 하위 질문으로 분해하는 전문가입니다. 이전 대화 기록을 참고하여 사용자의 현재 질문 의도를 명확히 파악하세요.

[이전 대화 기록]
{history_str}

[규칙]
- 각 하위 질문은 한 줄로 작성해주세요.
- 분해된 질문이 하나일 경우에도 그대로 목록에 포함해주세요.
- 불필요한 설명 없이 분해된 질문 목록만 출력해주세요.
- 마크다운(**,##,### 등), 한자, 영어 등 사용하지말고 한글로만 작성 해주세요.
- [가장 중요] 반드시 '이전 대화 기록'에서 언급된 주제(작물 이름 등)와 관련된 질문만 생성해야 합니다. 대화에 없던 새로운 주제를 절대 만들지 마세요.
- 대화 기록을 통해 현재 질문의 '그거', '저것'과 같은 대명사가 무엇을 가리키는지 파악하여 명시적인 질문으로 만드세요.

[예시]
(대화 기록에 '가지 재배법'에 대한 내용이 있었을 경우)
사용자 질문: 그럼 수확은 언제 해?
출력:
가지 수확 시기

(대화 기록에 '가지 재배법'에 대한 내용이 있었을 경우)
사용자 질문: 그럼 어떻게 요리해?
출력:
가지 요리 방법

[실제 질문]
사용자 질문: {user_query}
출력:"""
    chat_completion = groq_client.chat.completions.create(messages=[{"role": "user", "content": decomposer_prompt}], model="llama-3.1-8b-instant", temperature=0.0)
    decomposed_queries = chat_completion.choices[0].message.content.strip().split('\n')
    print(f"분해된 질문: {decomposed_queries}")
    return decomposed_queries

# [숏텀 메모리 추가] 2. 최종 답변 종합기에 대화 기록(history) 파라미터 추가
def synthesize_results(original_query: str, intermediate_answers: List[dict], history: List[BaseMessage]) -> str:
    """각 하위 질문에 대한 답변들을 종합하여 최종 답변을 생성합니다."""
    print("\n--- Synthesizer 노드 실행 ---")
    
    # [숏텀 메모리 추가] 대화 기록을 프롬프트에 포함
    history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in history])
    
    context = ""
    for item in intermediate_answers:
        context += f"### 하위 질문: {item['sub_query']}\n답변: {item['answer']}\n\n"
        
    synthesizer_prompt = f"""당신은 여러 정보를 종합하여 자연스러운 대화형 답변을 생성하는 전문가입니다. 이전 대화 기록과 새로 분석된 정보를 모두 참고하여 사용자의 질문에 답해주세요.

[이전 대화 기록]
{history_str}

[새로 분석된 정보]
{context}

[중요 규칙]
- 제목(##, ###), 목록(1., 2., *), 굵은 글씨(**) 등 어떤 마크다운 서식도 절대 사용하지 마세요.
- 모든 정보를 종합하여, 사용자의 원래 질문에 대한 완전하고 일관된 답변을 '대화체'로 부드럽게 작성해주세요.

[원래 질문]
{original_query}

[최종 답변]"""
    chat_completion = groq_client.chat.completions.create(messages=[{"role": "user", "content": synthesizer_prompt}], model="llama-3.1-8b-instant", temperature=LLM_TEMPERATURE)
    final_answer = chat_completion.choices[0].message.content
    print("최종 답변 생성 완료.")
    return final_answer

# --- 4. 메인 로직 (질문 분해 파이프라인) ---
async def main():
    """질문 분해 기반의 챗봇 메인 함수"""
    print("안녕하세용 작물에 해당하는 내용 질문 해주세용^^")
    print("-" * 70)

    # [숏텀 메모리 추가] 3. 대화 기록을 저장할 리스트 생성
    conversation_history: List[BaseMessage] = []

    while True:
        user_input = input("나: ")
        if user_input.lower() == '종료':
            print("챗봇: 대화를 종료합니다.")
            break

        # [숏텀 메모리 추가] 4. 질문 분해 시 전체 대화 기록을 함께 전달
        sub_queries = decompose_query(user_input, conversation_history)

        intermediate_answers = []
        print("\n--- 각 하위 질문에 대한 RAG 실행 시작 ---")
        for sub_query in sub_queries:
            rag_result = rag_app.invoke({"messages": [HumanMessage(content=sub_query)]})
            answer = rag_result['messages'][-1].content
            intermediate_answers.append({"sub_query": sub_query, "answer": answer})
        
        # [숏텀 메모리 추가] 5. 최종 답변 생성 시 전체 대화 기록을 함께 전달
        final_answer = synthesize_results(user_input, intermediate_answers, conversation_history)
        
        # [숏텀 메모리 추가] 6. 현재 대화를 기록에 추가
        conversation_history.append(HumanMessage(content=user_input))
        conversation_history.append(AIMessage(content=final_answer))

        cleaned_answer = clean_markdown(final_answer)

        print("\n" + "="*70)
        print(" 최종 답변 ".center(70, "="))
        print("="*70)
        # cleaned_answer 대신 final_answer를 출력하도록 유지 (요청사항 반영)
        print(f"챗봇: {final_answer}")
        print("-" * 70)


if __name__ == "__main__":
    asyncio.run(main())