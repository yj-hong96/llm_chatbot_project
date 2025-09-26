import os
from dotenv import load_dotenv
from groq import Groq
from typing import TypedDict, List
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, BaseMessage
from langgraph.graph import StateGraph, END

# .env 파일에서 환경 변수를 로드합니다.
load_dotenv()

# Groq 클라이언트를 초기화합니다.
try:
    client = Groq()
except Exception as e:
    print(f"오류: Groq 클라이언트를 초기화할 수 없습니다. {e}")
    print("'.env' 파일에 'GROQ_API_KEY'가 올바르게 설정되었는지 확인하세요.")
    exit()

# LangGraph 에이전트의 상태를 정의합니다.
# 대화 기록(messages)을 리스트로 관리합니다.
class AgentState(TypedDict):
    messages: List[BaseMessage]

# 모델을 호출하는 노드(Node) 함수를 정의합니다.
def call_model(state: AgentState) -> AgentState:
    """Groq LLM을 호출하여 응답을 생성하는 함수"""
    messages = state['messages']
    
    # LangChain의 메시지 형식을 Groq API가 요구하는 dict 형식으로 변환
    api_messages = [{"role": msg.type, "content": msg.content} for msg in messages]

    chat_completion = client.chat.completions.create(
        messages=api_messages,
        model="llama-3.3-70b-versatile",
        temperature=0.7,
    )
    bot_response_content = chat_completion.choices[0].message.content
    
    # AI의 응답을 AIMessage 객체로 만들어 반환
    return {"messages": [AIMessage(content=bot_response_content)]}

# LangGraph 워크플로우를 정의합니다.
workflow = StateGraph(AgentState)

# 'llm_node'라는 이름으로 모델 호출 함수를 노드로 추가합니다.
workflow.add_node("llm_node", call_model)

# 시작점(entry point)을 'llm_node'로 설정합니다.
workflow.set_entry_point("llm_node")

# 'llm_node' 실행 후에는 워크플로우를 종료하도록 엣지(edge)를 추가합니다.
workflow.add_edge("llm_node", END)

# 정의된 워크플로우를 실행 가능한 앱으로 컴파일합니다.
agent_app = workflow.compile()


def main():
    """
    대화형 챗봇의 메인 함수
    """
    print("Groq 챗봇에 오신 것을 환영합니다! '종료'를 입력하면 대화가 끝납니다.")
    print("-" * 60)

    system_prompt = "당신은 농업 전문가입니다. 사용자의 지역, 토양, 기후 조건에 맞는 최적의 작물을 추천하고, 재배 방법에 대한 조언을 제공합니다."
    messages: List[BaseMessage] = [SystemMessage(content=system_prompt)]

    while True:
        user_input = input("나: ")

        if user_input.lower() == '종료':
            print("챗봇: 대화를 종료합니다. 이용해주셔서 감사합니다!")
            break
        
        prompt_to_send = ""
        if user_input.lower() in ['더 자세히', '심층적으로']:
            if len(messages) < 2 or not isinstance(messages[-1], AIMessage):
                print("챗봇: 먼저 질문을 하고 답변을 받아야 심층적인 설명을 요청할 수 있습니다.")
                continue
            prompt_to_send = "방금 네가 한 마지막 답변에 대해 더 자세하고, 구체적인 예시를 들어 심층적으로 설명해줘."
        else:
            prompt_to_send = user_input
        
        # 사용자의 입력을 HumanMessage로 추가
        messages.append(HumanMessage(content=prompt_to_send))

        try:
            # LangGraph 에이전트 실행
            final_state = agent_app.invoke({"messages": messages})
            
            # 에이전트의 마지막 응답을 가져옴
            bot_response_message = final_state['messages'][-1]
            bot_response = bot_response_message.content
            print(f"챗봇: {bot_response}")

            # 전체 대화 기록에 AI의 응답 추가
            messages.append(bot_response_message)

        except Exception as e:
            print(f"API 호출 중 오류가 발생했습니다: {e}")
            # 오류가 발생한 경우 마지막 사용자 메시지 제거
            messages.pop()


if __name__ == "__main__":
    # 요청하신 그래프 시각화 코드를 추가합니다.
    # 이제 agent_app이 정의되었으므로 정상적으로 작동합니다.
    try:
        graph_image_path = "agent_workflow.png"
        with open(graph_image_path, "wb") as f:
            f.write(agent_app.get_graph().draw_mermaid_png())
        print(f"\nLangGraph 구조가 '{graph_image_path}' 파일로 저장되었습니다.")
    except Exception as e:
        print(f"그래프 시각화 중 오류 발생: {e}")
    
    main()

