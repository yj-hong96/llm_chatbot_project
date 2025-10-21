# Version: 1.0 - 지능형 메타 워크플로우
import os
import re
import time
import asyncio
import logging
from dotenv import load_dotenv
from groq import Groq, AsyncGroq, RateLimitError
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
    # 동기 및 비동기 클라이언트 모두 초기화
    groq_client = Groq()
    async_groq_client = AsyncGroq()
except Exception as e:
    logger.error(f"Groq 클라이언트를 초기화할 수 없습니다: {e}")
    exit()

MILVUS_HOST = "localhost"
MILVUS_PORT = "19530"
EMBEDDING_MODEL = "jhgan/ko-sroberta-multitask"
LLM_TEMPERATURE = 0.7

logger.info("임베딩 모델을 로드합니다...")
embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)

# --- 2. 에이전트별 클래스 정의 ---
class BaseAgent:
    """에이전트의 공통 기능을 정의하는 기본 클래스"""
    def __init__(self, collection_name: str, agent_name: str, rewriter_prompt: str, generator_prompt: str):
        self.agent_name = agent_name
        self.collection_name = collection_name
        self.rewriter_prompt_template = rewriter_prompt
        self.generator_prompt_template = generator_prompt
        self.collection = self._connect_milvus()
        self.rag_app = self._build_workflow()
        logger.info(f"✅ [{self.agent_name}] 에이전트가 성공적으로 초기화되었습니다.")

    def _connect_milvus(self):
        try:
            logger.info(f"[{self.agent_name}] Milvus에 연결하고 '{self.collection_name}' 컬렉션을 로드합니다...")
            if not connections.has_connection("default"):
                 connections.connect("default", host=MILVUS_HOST, port=MILVUS_PORT)
            
            collection = Collection(self.collection_name)
            collection.load()
            logger.info(f"[{self.agent_name}] '{self.collection_name}' 컬렉션 로드 완료.")
            return collection
        except Exception as e:
            logger.error(f"[{self.agent_name}] '{self.collection_name}' 컬렉션을 로드할 수 없습니다: {e}")
            raise

    def _build_workflow(self):
        class AgentState(TypedDict):
            messages: List[BaseMessage]
            documents: List[Document]
            rewritten_query: str

        def rewrite_query(state: AgentState) -> dict:
            messages = state['messages']
            last_message = messages[-1].content
            rewritten_query = last_message
            if len(messages) > 1:
                history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in messages[:-1]])
                rewrite_prompt = self.rewriter_prompt_template.format(history_str=history_str, last_message=last_message)
                try:
                    chat_completion = groq_client.chat.completions.create(messages=[{"role": "user", "content": rewrite_prompt}], model="llama-3.1-8b-instant", temperature=0.0)
                    rewritten_query = chat_completion.choices[0].message.content.strip()
                except Exception: pass
            logger.info(f"[{self.agent_name}] 재작성된 질문: {rewritten_query}")
            return {"rewritten_query": rewritten_query}

        def retrieve_documents(state: AgentState) -> dict:
            query = state['rewritten_query']
            logger.info(f"[{self.agent_name}] Retriever 실행 (검색 질문: '{query[:30]}...')")
            query_vector = embeddings.embed_query(query)
            results = self.collection.search(data=[query_vector], anns_field="vector", param={"metric_type": "L2", "params": {"nprobe": 10}}, limit=3, output_fields=["text"])
            docs = [Document(page_content=hit.entity.get('text')) for hit in results[0]] if results and results[0] else []
            logger.info(f"[{self.agent_name}] 검색된 문서 {len(docs)}개")
            return {"documents": docs}
        
        def generate_response(state: AgentState) -> dict:
            logger.info(f"[{self.agent_name}] Generator 실행")
            context = "\n\n".join([doc.page_content for doc in state['documents']])
            history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in state['messages']])
            final_prompt = self.generator_prompt_template.format(context=context, history_str=history_str)
            if not context.strip():
                return {"messages": [AIMessage(content="")]}
            
            chat_completion = groq_client.chat.completions.create(messages=[{"role": "user", "content": final_prompt}], model="llama-3.3-70b-versatile", temperature=LLM_TEMPERATURE)
            response = chat_completion.choices[0].message.content
            return {"messages": [AIMessage(content=response)]}

        workflow = StateGraph(AgentState)
        workflow.add_node("rewriter", rewrite_query)
        workflow.add_node("retriever", retrieve_documents)
        workflow.add_node("generator", generate_response)
        workflow.set_entry_point("rewriter")
        workflow.add_edge("rewriter", "retriever")
        workflow.add_edge("retriever", "generator")
        workflow.add_edge("generator", END)
        return workflow.compile()

# --- 3. 각 전문 에이전트의 프롬프트 정의 ---
FARMER_REWRITER_PROMPT = """당신은 사용자의 질문을 '작물 추천, 재배, 농업 정보' 검색에 적합한 질문으로 재작성하는 전문가입니다.
[대화 기록]\n{history_str}\n[사용자의 마지막 질문]\n{last_message}\n[재작성된 검색용 질문]"""
FARMER_GENERATOR_PROMPT = """당신은 '작물 추천 전문 AI'입니다. 검색된 농업 정보를 바탕으로 답변을 생성하세요.
[검색된 정보]\n{context}\n[대화 기록]\n{history_str}\n[최종 답변]"""
RECIPE_REWRITER_PROMPT = """당신은 사용자의 질문을 '요리, 레시피, 음식 정보' 검색에 적합한 질문으로 재작성하는 전문가입니다.
[대화 기록]\n{history_str}\n[사용자의 마지막 질문]\n{last_message}\n[재작성된 검색용 질문]"""
RECIPE_GENERATOR_PROMPT = """당신은 'AI 셰프'입니다. 검색된 레시피 정보를 바탕으로 답변을 생성하세요.
[검색된 정보]\n{context}\n[대화 기록]\n{history_str}\n[최종 답변]"""

# 에이전트 인스턴스 생성
try:
    farmer_agent = BaseAgent("farmer", "FarmerAgent", FARMER_REWRITER_PROMPT, FARMER_GENERATOR_PROMPT)
    # ====[수정된 부분: 컬렉션 이름 원복]====
    recipe_agent = BaseAgent("receipe", "RecipeAgent", RECIPE_REWRITER_PROMPT, RECIPE_GENERATOR_PROMPT)
except Exception as e:
    logger.critical(f"에이전트 초기화 실패: {e}. 프로그램을 종료합니다.")
    exit()

# --- 4. 메타 워크플로우 상태 및 노드 정의 ---
class MainAgentState(TypedDict):
    messages: List[BaseMessage]
    route: Literal["farmer", "recipe", "both"]
    farmer_response: str
    recipe_response: str

async def route_question_node(state: MainAgentState) -> dict:
    logger.info("\n--- 메인 라우터 실행: 사용자 질문 의도 분석 ---")
    question = state["messages"][-1].content
    history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in state["messages"][:-1]])
    routing_prompt = f"""당신은 사용자의 질문 의도를 분석하여 'farmer'(농업), 'recipe'(요리), 'both'(둘 다) 중 하나로 분류하는 라우터입니다.
[대화 기록]\n{history_str}\n[사용자 질문]\n{question}\n[분류]"""
    try:
        chat_completion = await async_groq_client.chat.completions.create(messages=[{"role": "user", "content": routing_prompt}], model="llama-3.1-8b-instant", temperature=0.0)
        intent = chat_completion.choices[0].message.content.strip().lower()
        if "farmer" in intent and "recipe" not in intent: return {"route": "farmer"}
        if "recipe" in intent and "farmer" not in intent: return {"route": "recipe"}
        return {"route": "both"}
    except Exception: return {"route": "both"}

async def run_farmer_agent_node(state: MainAgentState) -> dict:
    logger.info(">> FarmerAgent 단독 실행...")
    result = await farmer_agent.rag_app.ainvoke({"messages": state["messages"]})
    return {"farmer_response": result['messages'][-1].content}

async def run_recipe_agent_node(state: MainAgentState) -> dict:
    logger.info(">> RecipeAgent 단독 실행...")
    result = await recipe_agent.rag_app.ainvoke({"messages": state["messages"]})
    return {"recipe_response": result['messages'][-1].content}

async def run_both_agents_node(state: MainAgentState) -> dict:
    logger.info(">> FarmerAgent와 RecipeAgent 병렬 실행...")
    farmer_task = farmer_agent.rag_app.ainvoke({"messages": state["messages"]})
    recipe_task = recipe_agent.rag_app.ainvoke({"messages": state["messages"]})
    results = await asyncio.gather(farmer_task, recipe_task)
    return {"farmer_response": results[0]['messages'][-1].content, "recipe_response": results[1]['messages'][-1].content}

async def synthesize_node(state: MainAgentState) -> dict:
    logger.info("\n--- Synthesizer 실행: 답변 종합 ---")
    synthesis_prompt = f"""당신은 여러 전문가의 보고서를 취합하여 하나의 완벽한 답변으로 재구성하는 최종 보고자입니다.
[사용자 질문]\n{state["messages"][-1].content}
[전문가 보고서]\n- 작물 전문가: {state.get('farmer_response', '')}\n- 레시피 전문가: {state.get('recipe_response', '')}
[지침] 두 보고서의 핵심 정보만 추출하여 자연스러운 하나의 이야기로 합치고, 유용한 후속 질문을 제안하세요.
[최종 답변]"""
    try:
        chat_completion = await async_groq_client.chat.completions.create(messages=[{"role": "user", "content": synthesis_prompt}], model="llama-3.3-70b-versatile", temperature=LLM_TEMPERATURE)
        final_answer = chat_completion.choices[0].message.content
        return {"messages": state["messages"] + [AIMessage(content=final_answer)]}
    except Exception as e:
        return {"messages": state["messages"] + [AIMessage(content="죄송합니다, 답변 종합 중 오류가 발생했습니다.")]}

# --- 5. 메타 워크플로우 구축 ---
main_workflow = StateGraph(MainAgentState)
main_workflow.add_node("router", route_question_node)
main_workflow.add_node("run_farmer", run_farmer_agent_node)
main_workflow.add_node("run_recipe", run_recipe_agent_node)
main_workflow.add_node("run_both", run_both_agents_node)
main_workflow.add_node("synthesizer", synthesize_node)

main_workflow.set_entry_point("router")
main_workflow.add_conditional_edges(
    "router",
    lambda state: state["route"],
    {"farmer": "run_farmer", "recipe": "run_recipe", "both": "run_both"}
)

def combine_single_response(state: MainAgentState) -> dict:
    response = state.get("farmer_response") or state.get("recipe_response")
    return {"messages": state["messages"] + [AIMessage(content=response)]}

main_workflow.add_node("combine_single", combine_single_response)
main_workflow.add_edge("run_farmer", "combine_single")
main_workflow.add_edge("run_recipe", "combine_single")
main_workflow.add_edge("run_both", "synthesizer")
main_workflow.add_edge("synthesizer", END)
main_workflow.add_edge("combine_single", END)

main_rag_app = main_workflow.compile()

# --- 6. 챗봇 메인 로직 ---
async def main():
    print("\n" + "="*70)
    print(" AI 농업 & 요리 전문가 (메타 워크플로우 모드) ".center(70, "="))
    print("="*70)
    print("안녕하세요! 작물, 레시피 등 무엇이든 물어보세요.")
    print("-" * 70)

    conversation_history: List[BaseMessage] = []

    while True:
        user_input = input("나: ")
        if user_input.lower() == '종료': break

        current_messages = conversation_history + [HumanMessage(content=user_input)]
        
        try:
            initial_state = {
                "messages": current_messages,
                "route": "",
                "farmer_response": "",
                "recipe_response": ""
            }
            final_state = await main_rag_app.ainvoke(initial_state)
            final_answer = final_state['messages'][-1].content
            
            print(f"챗봇: ", end="", flush=True)
            for char in final_answer:
                print(char, end="", flush=True)
                time.sleep(0.02)
            print()

            conversation_history.append(HumanMessage(content=user_input))
            conversation_history.append(AIMessage(content=final_answer))
            print("-" * 70)

        except Exception as e:
            logger.error(f"메인 루프 중 오류: {e}", exc_info=True)
            print(f"\n죄송합니다, 오류가 발생했습니다.")

if __name__ == "__main__":
    try:
        with open("main_workflow.png", "wb") as f:
            f.write(main_rag_app.get_graph().draw_mermaid_png())
        logger.info("메인 워크플로우 구조가 'main_workflow.png' 파일로 저장되었습니다.")
    except Exception as e:
        logger.warning(f"그래프 시각화 중 오류: {e}")
        
    asyncio.run(main())

