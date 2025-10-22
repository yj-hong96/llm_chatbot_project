## Version: 7.2 - 조건부 라우팅 재도입을 통한 진정한 병렬 워크플로우 구현
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

# --- 2. 전문가 에이전트 클래스 정의 ---
class BaseExpertAgent:
    """각 전문가 AI의 워크플로우와 기능을 정의하는 클래스"""
    def __init__(self, name: str, collection_name: str, persona_prompt: str):
        self.name = name
        self.collection_name = collection_name
        self.persona_prompt = persona_prompt
        self.workflow = self._build_workflow()
        
        logger.info(f"[{self.name}] Milvus에 연결하고 '{self.collection_name}' 컬렉션을 로드합니다...")
        try:
            if not connections.has_connection("default"):
                connections.connect("default", host=MILVUS_HOST, port=MILVUS_PORT)
            self.collection = Collection(self.collection_name)
            self.collection.load()
            logger.info(f"[{self.name}] '{self.collection_name}' 컬렉션 로드 완료.")
        except Exception as e:
            logger.error(f"[{self.name}] Milvus 컬렉션을 로드할 수 없습니다: {e}")
            raise e

    async def _rewrite_query(self, state: dict) -> dict:
        messages = state['messages']
        last_message = messages[-1]
        history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in messages[:-1]])
        
        rewrite_prompt = f"""당신은 '{self.name}' 전문가입니다. 당신의 임무는 사용자의 최신 질문이 당신의 전문 분야와 관련이 있는지 판단하고, 관련이 있다면 검색에 최적화된 질문으로 재작성하는 것입니다.

[당신의 전문 분야]
{self.persona_prompt}

[대화 기록]
{history_str}

[사용자의 최신 질문]
{last_message.content}

[판단 및 재작성 지침]
1.  **관련성 판단**: [사용자의 최신 질문]이 [당신의 전문 분야]와 명확하게 관련이 있습니까?
2.  **관련 없는 경우**: 관련이 없다면, 다른 어떤 텍스트도 없이 오직 "pass" 라고만 응답하세요.
3.  **관련 있는 경우**: [대화 기록]을 참고하여 사용자의 질문에 있는 모호한 표현의 의미를 파악하고, 당신의 전문 분야에 맞는 구체적인 '검색용 질문'을 한 줄로 만드세요.

[절대 규칙]
- 당신의 출력은 오직 '재작성된 검색용 질문' 또는 "pass" 여야 합니다.
- 절대 당신의 판단 과정이나 '[판단]', '[재작성]'과 같은 단어를 포함해서는 안 됩니다.

[당신의 최종 출력]:"""

        chat_completion = await async_groq_client.chat.completions.create(
            messages=[{"role": "user", "content": rewrite_prompt}],
            model="llama-3.1-8b-instant",
            temperature=0.0
        )
        rewritten_query = chat_completion.choices[0].message.content.strip()
        logger.info(f"[{self.name}] 재작성된 질문: {rewritten_query}")
        return {**state, "rewritten_query": rewritten_query}

    async def _retrieve(self, state: dict) -> dict:
        rewritten_query = state['rewritten_query']
        if rewritten_query == "pass":
            logger.info(f"[{self.name}] 전문 분야와 관련 없어 Retriever를 건너뜁니다.")
            return {**state, "documents": []}

        logger.info(f"[{self.name}] Retriever 실행 (검색 질문: '{rewritten_query[:30]}...')")
        query_vector = embeddings.embed_query(rewritten_query)
        search_params = {"metric_type": "L2", "params": {"nprobe": 10}}
        results = self.collection.search(data=[query_vector], anns_field="vector", param=search_params, limit=3, output_fields=["text", "source", "page"])
        retrieved_docs = [Document(page_content=hit.entity.get('text')) for hit in results[0]] if results and results[0] else []
        logger.info(f"[{self.name}] 검색된 문서 {len(retrieved_docs)}개")
        return {**state, "documents": retrieved_docs}

    async def _generate(self, state: dict) -> dict:
        if state['rewritten_query'] == "pass" or not state['documents']:
             logger.info(f"[{self.name}] 생성할 정보가 없어 Generator를 건너뜁니다.")
             return {**state, "generation": ""}

        logger.info(f"[{self.name}] Generator 실행")
        context = "\n\n".join([doc.page_content for doc in state['documents']])
        prompt = f"""당신은 '{self.name}'입니다. 주어진 [참고 정보]만을 사용하여 [검색용 질문]에 대한 답변의 '핵심 내용'만 간결하게 요약하세요.

[참고 정보]
{context}

[검색용 질문]
{state['rewritten_query']}

[핵심 내용 요약]"""
        api_messages = [{"role": "user", "content": prompt}]
        chat_completion = await async_groq_client.chat.completions.create(messages=api_messages, model="llama-3.1-8b-instant", temperature=0.0)
        generation = chat_completion.choices[0].message.content
        return {**state, "generation": generation}

    def _build_workflow(self):
        workflow = StateGraph(dict)
        workflow.add_node("rewriter", self._rewrite_query)
        workflow.add_node("retriever", self._retrieve)
        workflow.add_node("generator", self._generate)
        workflow.set_entry_point("rewriter")
        workflow.add_edge("rewriter", "retriever")
        workflow.add_edge("retriever", "generator")
        workflow.add_edge("generator", END)
        return workflow.compile()

    async def run(self, messages: List[BaseMessage]):
        return await self.workflow.ainvoke({"messages": messages})

# --- 3. 메타 에이전트 및 메인 워크플로우 정의 ---
class MetaAgentState(TypedDict):
    messages: List[BaseMessage]
    expert_responses: dict
    # ====[수정된 부분 1: 상태 키 변경]====
    # 라우팅 결과를 저장하는 키 이름을 'route'로 변경하여 명확성을 높입니다.
    route: str

async def llm_router_node(state: MetaAgentState) -> dict:
    """LLM을 사용하여 사용자의 질문 의도를 분석하고 다음 단계를 결정합니다."""
    logger.info("\n--- LLM 라우터 실행: 사용자 질문 의도 분석 ---")
    question = state["messages"][-1].content
    history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in state["messages"][:-1]])
    
    expert_definitions = "\n".join([f"- {agent.name}: {agent.persona_prompt}" for agent in expert_agents.values()])
    
    routing_prompt = f"""당신은 사용자의 질문 의도를 분석하여 'farmer'(농업), 'recipe'(요리), 'both'(둘 다) 중 하나로 분류하는 지능형 라우터입니다.

[사용 가능한 전문가 목록]
{expert_definitions}

[대화 기록]
{history_str}

[사용자 질문]
{question}

[지침]
1. [사용자 질문]과 [대화 기록]을 종합적으로 고려하여 질문의 핵심 의도를 파악하세요.
2. 파악한 의도에 가장 적합한 경로를 'farmer', 'recipe', 'both' 중에서 선택하세요.

[절대 규칙]
- 당신의 최종 출력은 오직 'farmer', 'recipe', 'both' 중 하나여야 합니다.
- 절대 당신의 분석 과정, 설명, 다른 문장을 포함해서는 안 됩니다.

[실제 분류 결과]:"""
    try:
        chat_completion = await async_groq_client.chat.completions.create(
            messages=[{"role": "user", "content": routing_prompt}],
            model="llama-3.1-8b-instant",
            temperature=0.0
        )
        intent = chat_completion.choices[0].message.content.strip().lower()
        
        route = "both" # 기본값
        if "farmer" in intent and "recipe" in intent:
            route = "both"
        elif "farmer" in intent:
            route = "farmer"
        elif "recipe" in intent:
            route = "recipe"
        
        logger.info(f"라우팅 결정: '{route}' 경로로 진행")
        return {"route": route}
    except Exception as e:
        logger.error(f"라우팅 중 오류 발생: {e}, 'both' 경로로 진행합니다.")
        return {"route": "both"}

async def run_farmer_expert_node(state: MetaAgentState) -> dict:
    logger.info("\n>> 작물 전문가 단독 실행...")
    result = await farmer_agent.run(state['messages'])
    return {"expert_responses": {farmer_agent.name: result.get("generation", "")}}

async def run_recipe_expert_node(state: MetaAgentState) -> dict:
    logger.info("\n>> 레시피 전문가 단독 실행...")
    result = await recipe_agent.run(state['messages'])
    return {"expert_responses": {recipe_agent.name: result.get("generation", "")}}

async def run_both_experts_node(state: MetaAgentState) -> dict:
    logger.info(f"\n>> {farmer_agent.name}와 {recipe_agent.name} 병렬 실행...")
    results = await asyncio.gather(
        farmer_agent.run(state['messages']),
        recipe_agent.run(state['messages'])
    )
    expert_responses = {
        farmer_agent.name: results[0].get("generation", ""),
        recipe_agent.name: results[1].get("generation", "")
    }
    return {"expert_responses": expert_responses}

async def synthesize_final_answer_node(state: MetaAgentState) -> dict:
    """각 전문가의 답변을 종합하여 최종 답변을 생성합니다."""
    logger.info("\n--- Synthesizer 실행: 답변 종합 ---")
    messages = state['messages']
    expert_responses = state['expert_responses']
    
    context = ""
    for name, response in expert_responses.items():
        if response:
            context += f"### {name}의 의견\n{response}\n\n"
            
    if not context:
        final_answer = "죄송하지만, 문의하신 내용에 대해 답변할 수 있는 전문가를 찾지 못했습니다."
    else:
        synth_prompt = f"""당신은 여러 전문가의 보고서를 취합하여, 사용자의 질문에 대한 하나의 완벽하고 종합적인 답변을 작성하는 '수석 AI 커뮤니케이터'입니다.

[이전 대화 기록]
{"\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in messages[:-1]])}

[사용자의 최신 질문]
{messages[-1].content}

[각 전문가의 의견 요약]
{context}

[최종 답변 생성 지침]
1.  **자연스러운 종합 (가장 중요)**: 각 전문가의 의견을 "작물 전문가에 따르면..."과 같이 직접적으로 인용하지 마세요. 모든 정보를 자연스럽게 융합하여, 마치 한 명의 전문가가 종합적으로 설명하는 것처럼 하나의 완성된 이야기로 재구성해야 합니다.
2.  **자연스러운 흐름**: 사용자의 질문에 대한 답변으로 시작하여, 각 전문가의 의견을 자연스럽게 통합하여 설명하세요.
3.  **지능적인 후속 질문**: 답변의 핵심 주제와 관련된 유용한 후속 질문을 제안하여 대화를 쉽게 이어갈 수 있도록 도와주세요.

[절대 규칙]
- **언어 순수성 (매우 중요)**: 최종 답변은 **오직 순수 한글**로만 작성되어야 합니다.
- **품종 이름 일반화**: '설향' 같은 품종 이름은 대표 작물 이름인 '딸기' 등으로 바꿔서 설명해야 합니다.
- **형식 엄수**: 마크다운 서식(##, *, 1. 등)은 절대 사용하지 마세요.

[실제 작업]
[최종 답변]"""
        chat_completion = await async_groq_client.chat.completions.create(
            messages=[{"role": "user", "content": synth_prompt}],
            model="llama-3.3-70b-versatile",
            temperature=LLM_TEMPERATURE
        )
        final_answer = chat_completion.choices[0].message.content

    final_messages = messages + [AIMessage(content=final_answer)]
    return {**state, "messages": final_messages}


# --- 4. 메인 워크플로우 구축 및 실행 ---
if __name__ == "__main__":
    farmer_agent = BaseExpertAgent(
        name="작물 전문가",
        collection_name="farmer",
        persona_prompt="작물 추천, 재배 환경, 성장 조건 등 농업 기술에 대한 모든 것을 다룹니다."
    )
    recipe_agent = BaseExpertAgent(
        name="레시피 전문가",
        collection_name="receipe",
        persona_prompt="다양한 식재료를 활용한 요리 방법, 레시피, 조리 팁을 다룹니다."
    )
    expert_agents = { "작물 전문가": farmer_agent, "레시피 전문가": recipe_agent }

    # ====[수정된 부분 2: 진정한 병렬 워크플로우 재구축]====
    # 문제점: 워크플로우가 실제로는 분기되지 않고 선형적으로 실행됨.
    # 해결책: '조건부 엣지'를 다시 도입하여, 라우터의 결정에 따라
    # 워크플로우가 실제로 'farmer', 'recipe', 'both' 경로로 분기되도록 재설계했습니다.
    main_workflow = StateGraph(MetaAgentState)
    main_workflow.add_node("router", llm_router_node)
    main_workflow.add_node("run_farmer", run_farmer_expert_node)
    main_workflow.add_node("run_recipe", run_recipe_expert_node)
    main_workflow.add_node("run_both", run_both_experts_node)
    main_workflow.add_node("synthesizer", synthesize_final_answer_node)

    main_workflow.set_entry_point("router")
    
    # 라우터의 결정('route' 상태값)에 따라 다음 노드로 분기
    main_workflow.add_conditional_edges(
        "router",
        lambda state: state["route"],
        {
            "farmer": "run_farmer", 
            "recipe": "run_recipe", 
            "both": "run_both"
        }
    )
    
    # 각 전문가 노드는 실행 후 모두 synthesizer로 모입니다.
    main_workflow.add_edge("run_farmer", "synthesizer")
    main_workflow.add_edge("run_recipe", "synthesizer")
    main_workflow.add_edge("run_both", "synthesizer")
    
    # synthesizer가 최종 답변을 생성한 후 워크플로우를 종료합니다.
    main_workflow.add_edge("synthesizer", END)
    
    app = main_workflow.compile()
    
    # 그래프 시각화
    try:
        graph_image_path = "main_workflow.png"
        with open(graph_image_path, "wb") as f:
            f.write(app.get_graph().draw_mermaid_png())
        logger.info(f"메인 워크플로우 구조가 '{graph_image_path}' 파일로 저장되었습니다.")
    except Exception as e:
        logger.warning(f"그래프 시각화 중 외부 API 접속에 실패했습니다 (챗봇 기능에 영향 없음).")

    # 챗봇 실행
    print("\n" + "="*70)
    print(" AI 농업 & 요리 전문가 (메타 워크플로우 모드) ".center(70, "="))
    print("="*70)
    print("안녕하세요! 작물, 레시피 등 무엇이든 물어보세요.")
    print("-" * 70)
    
    current_state = {"messages": []}

    async def chat_loop():
        while True:
            user_input = await asyncio.to_thread(input, "나: ")
            if user_input.lower() == '종료':
                print("챗봇: 대화를 종료합니다.")
                break

            current_state["messages"].append(HumanMessage(content=user_input))
            
            try:
                final_state = await app.ainvoke(current_state)
                current_state["messages"] = final_state["messages"]
                
                final_bot_message = current_state["messages"][-1]
                
                print(f"챗봇: ", end="", flush=True)
                for char in final_bot_message.content:
                    print(char, end="", flush=True)
                    await asyncio.sleep(0.02)
                print("\n" + "-"*70)

            except Exception as e:
                logger.error(f"메인 루프에서 오류 발생: {e}", exc_info=True)
                current_state["messages"].pop()

    asyncio.run(chat_loop())

