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

def decompose_query(user_query: str, history: List[BaseMessage]) -> List[str]:
    """사용자의 복잡한 질문을 검색에 용이한 여러 개의 하위 질문으로 분해합니다."""
    print("\n--- Decomposer 노드 실행 ---")
    
    history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in history])

    decomposer_prompt = f"""당신은 사용자의 최신 질문을 명확하고 검색 가능한 하위 질문들로 분해하는 전문가입니다. 당신의 목표는 오직 '검색'에 가장 효율적인 형태로 질문을 재구성하는 것입니다.

[이전 대화 기록]
{history_str}

[절대 규칙]
- **절대 이전 대화를 요약하거나 정리하지 마세요.** 당신의 임무는 오직 사용자의 마지막 질문을 분해하는 것입니다.
- 각 하위 질문은 독립적으로 검색될 수 있도록 완전한 문장 형태여야 합니다.
- 대화 기록을 참고하여, '그거', '어떻게', '왜' 와 같은 모호한 표현이 어떤 구체적인 대상(예: 셀러리)을 지칭하는지 명확히 하여 질문을 재구성하세요.
- 사용자의 질문이 이미 단순하고 명확하다면, 불필요하게 나누지 말고 거의 그대로 출력하세요.
- 최종 출력은 오직 분해된 질문 목록이어야 하며, 다른 설명이나 제목을 절대 포함해서는 안 됩니다.
- 출력하는 모든 텍스트는 순수 한글이어야 합니다. (영어, 한자 등 금지)

[분해 예시 1]
- 이전 대화: 고랭지 작물로 셀러리를 추천함.
- 사용자 질문: 그럼 어떻게 재배하고 수확은 언제 해?
- 출력:
셀러리 재배 방법
셀러리 수확 시기

[분해 예시 2]
- 이전 대화: 없음
- 사용자 질문: 배추의 병해충 종류와 방제법 알려줘.
- 출력:
배추의 주요 병해충 종류
배추 병해충 방제법

[실제 분해 작업]
- 사용자 질문: {user_query}
- 출력:"""
    chat_completion = groq_client.chat.completions.create(messages=[{"role": "user", "content": decomposer_prompt}], model="llama-3.1-8b-instant", temperature=0.0)
    decomposed_queries = chat_completion.choices[0].message.content.strip().split('\n')
    
    if not decomposed_queries or all(q.strip() == '' for q in decomposed_queries):
        decomposed_queries = [user_query]
        print(f"질문 분해 실패. 원본 질문 사용: {decomposed_queries}")
    else:
        decomposed_queries = [q.strip() for q in decomposed_queries if q.strip()]
        print(f"분해된 질문: {decomposed_queries}")
        
    return decomposed_queries

def synthesize_results(original_query: str, intermediate_answers: List[dict], history: List[BaseMessage]) -> str:
    """각 하위 질문에 대한 답변들을 종합하여 최종 답변을 생성합니다."""
    print("\n--- Synthesizer 노드 실행 ---")
    
    history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in history])
    
    context = ""
    for item in intermediate_answers:
        context += f"### 하위 질문: {item['sub_query']}\n답변: {item['answer']}\n\n"
        
    synthesizer_prompt = f"""당신은 친절하고 유능한 '농업 기술 전문 AI 조수'입니다. 주어진 모든 정보를 종합하여 사용자의 질문에 대한 최종 답변을 생성하는 임무를 맡았습니다.

[이전 대화 기록]
{history_str}

[새로 검색된 정보]
{context}

[원래 질문]
{original_query}

[답변 생성 지침]
1.  **페르소나 유지**: 항상 친절하고 전문적인 조수의 말투를 유지하세요. 사용자가 이해하기 쉽도록 명확하고 부드러운 대화체로 답변을 작성해야 합니다.
2.  **정보 종합 및 재구성**: [새로 검색된 정보]에 있는 각각의 답변들을 단순히 나열하지 마세요. 모든 정보를 유기적으로 연결하고, 내용이 중복된다면 하나로 요약하여 하나의 완성된 답변으로 재구성해야 합니다.
3.  **작물 이름 일반화 (매우 중요)**: 답변에 '유타개량 15호', '설향', '대관령'과 같은 구체적인 **품종** 이름이 언급될 경우, 반드시 그것이 속한 **상위 작물**(예: 셀러리, 딸기, 감자) 이름으로 일반화하여 설명하세요. 사용자는 품종이 아닌 작물 자체에 대해 궁금해합니다.
4.  **언어 순수성**: 최종 답변은 **오직 순수 한글**로만 작성되어야 합니다. 영어, 한자(예: 進行->진행), 일본어, 이모티콘, 깨진 문자 등 다른 언어나 문자는 절대 포함해서는 안 됩니다.
5.  **형식 엄수**: 제목(##), 목록(*, 1.), 굵은 글씨(**) 등 어떤 종류의 마크다운 서식도 절대 사용하지 마세요. 오직 순수한 문장으로만 답변을 구성해야 합니다.
6.  **솔직함과 근거 기반 답변**: 답변은 반드시 [새로 검색된 정보]에 있는 내용만을 근거로 해야 합니다. 만약 정보가 질문에 답하기에 부족하거나 없다면, 절대로 추측하거나 꾸며내지 마세요. 이 경우, "죄송하지만, 제공된 정보만으로는 해당 내용에 대해 정확히 답변하기 어렵습니다."라고 솔직하게 말해야 합니다.
7.  **[추가] 후속 질문 유도**: 모든 답변이 끝난 후, 마지막에 사용자가 궁금해할 만한 관련 질문을 한두 가지 제안하여 대화를 자연스럽게 유도하세요. 질문 앞에는 물음표 이모지(❓)를 붙여주세요.

위 지침에 따라 최종 답변을 생성하세요.

[최종 답변 예시]
(사용자가 '셀러리 재배법'을 물어봤을 경우의 답변 예시입니다)

셀러리는 서늘한 기후를 좋아하는 작물이라 온도 관리가 중요합니다. 보통 15도에서 20도 사이를 유지해주는 것이 좋고, 흙이 마르지 않도록 물을 충분히 주어야 합니다. 너무 건조하면 줄기가 딱딱해져 품질이 떨어질 수 있습니다.

❓ 셀러리의 병해충 예방 방법에 대해 더 알아볼까요?
❓ 셀러리를 수확한 후 어떻게 보관하는 것이 좋은지 알려드릴까요?

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

    conversation_history: List[BaseMessage] = []

    while True:
        user_input = input("나: ")
        if user_input.lower() == '종료':
            print("챗봇: 대화를 종료합니다.")
            break

        sub_queries = decompose_query(user_input, conversation_history)

        intermediate_answers = []
        print("\n--- 각 하위 질문에 대한 RAG 실행 시작 ---")
        
        rate_limit_reached = False
        for sub_query in sub_queries:
            try:
                rag_result = rag_app.invoke({"messages": [HumanMessage(content=sub_query)]})
                answer = rag_result['messages'][-1].content
                intermediate_answers.append({"sub_query": sub_query, "answer": answer})
            
            except RateLimitError:
                print("\n" + "="*70)
                print("🚫 API 사용량 초과 알림 🚫".center(68))
                print("="*70)
                print("현재 Groq API의 하루 사용 가능량을 모두 소진했습니다.")
                print("이 질문에 대한 답변을 더 이상 생성할 수 없습니다.")
                print("\n[해결 방법]")
                print("- 잠시 후 다시 시도하시거나, 내일 API 사용량이 초기화된 후 이용해 주세요.")
                print("-" * 70)
                rate_limit_reached = True
                break
        
        if rate_limit_reached:
            continue
            
        final_answer = synthesize_results(user_input, intermediate_answers, conversation_history)
        
        conversation_history.append(HumanMessage(content=user_input))
        conversation_history.append(AIMessage(content=final_answer))

        cleaned_answer = clean_markdown(final_answer)

        print("\n" + "="*70)
        print(" 최종 답변 ".center(70, "="))
        print("="*70)
        print(f"챗봇: {final_answer}")
        print("-" * 70)

if __name__ == "__main__":
    # 그래프 시각화
    try:
        graph_image_path = "agent_workflow.png"
        with open(graph_image_path, "wb") as f:
            # 변수 이름을 'rag_app'으로 수정하여 오류 해결
            f.write(rag_app.get_graph().draw_mermaid_png())
        print(f"\n✅ LangGraph 구조가 '{graph_image_path}' 파일로 저장되었습니다.")
    except Exception as e:
        print(f"\n[알림] 그래프 시각화 중 오류가 발생했습니다: {e}")

    # 이미지 생성 후, 챗봇의 메인 함수를 실행합니다.
    asyncio.run(main())
