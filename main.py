## Version: 7.7 - 전체 주석 및 흐름 설명 추가
# [주석] os: .env 파일을 로드하거나 파일 경로를 다룰 때 사용합니다.
import os
# [주석] re: 정규 표현식. 여기서는 특별히 사용되진 않지만, 복잡한 텍스트 처리에 유용합니다.
import re
# [주석] time: 챗봇 답변 시 타이핑 효과(sleep)를 위해 사용합니다.
import time
# [주석] asyncio: '비동기' I/O를 지원합니다. 챗봇이 여러 작업을 동시에(예: API 호출, 사용자 입력 대기) 처리할 수 있게 해줍니다.
import asyncio
# [주석] logging: 코드 실행 중 발생하는 정보, 경고, 오류를 파일이나 콘솔에 기록(로그)하기 위해 사용합니다.
import logging
# [주석] dotenv.load_dotenv: .env 파일에 저장된 GROQ_API_KEY 같은 민감한 정보를 환경 변수로 불러옵니다.
from dotenv import load_dotenv
# [주석] groq: Groq API를 사용하기 위한 클라이언트 라이브러리입니다. (AsyncGroq는 비동기용)
from groq import Groq, AsyncGroq, RateLimitError
# [주석] typing: 코드의 타입을 명시하여(예: List[str]는 문자열 리스트), 실수를 줄이고 가독성을 높입니다.
from typing import TypedDict, List, Literal, Dict
# [주석] langchain_core.messages: 챗봇의 대화 기록(HumanMessage, AIMessage)을 구조화된 형태로 관리합니다.
from langchain_core.messages import HumanMessage, AIMessage, BaseMessage
# [주석] langchain_core.documents: 검색 결과를 'Document'라는 표준화된 객체로 다룹니다.
from langchain_core.documents import Document
# [주석] langchain_huggingface: 허깅페이스의 임베딩 모델(ko-sroberta)을 쉽게 불러와 사용합니다.
from langchain_huggingface import HuggingFaceEmbeddings
# [주석] pymilvus: 벡터 데이터베이스인 Milvus에 연결하고 데이터를 검색(search)하기 위해 사용합니다.
from pymilvus import connections, Collection
# [주석] langgraph: 'StateGraph'를 사용해 챗봇의 복잡한 흐름(라우팅, 병렬 실행)을 '그래프' 형태로 쉽게 설계합니다.
from langgraph.graph import StateGraph, END

# --- 1. 로깅 및 초기 설정 ---
# [주석] 로깅 기본 설정. INFO 레벨 이상의 모든 로그를 '시간 - 레벨 - 메시지' 형식으로 콘솔에 출력합니다.
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
# [주석] 'logger' 객체를 생성합니다. 이 객체를 사용해 코드 곳곳에 로그를 남깁니다.
logger = logging.getLogger(__name__)

# [주석] .env 파일에서 환경 변수를 로드합니다. (예: GROQ_API_KEY=...)
load_dotenv()
try:
    # [주석] Groq API에 비동기(async)로 연결할 수 있는 클라이언트를 생성합니다.
    async_groq_client = AsyncGroq()
except Exception as e:
    logger.error(f"Groq 클라이언트를 초기화할 수 없습니다: {e}")
    # [주석] API 키 등이 없어 클라이언트 생성에 실패하면 프로그램을 종료합니다.
    exit()

# --- [ 상수 정의 ] ---
# [주석] Milvus DB가 실행 중인 주소 (docker-compose.yml과 일치해야 함)
MILVUS_HOST = "localhost"
# [주석] Milvus DB가 사용하는 포트 (docker-compose.yml과 일치해야 함)
MILVUS_PORT = "19530"
# [주석] HuggingFace에서 가져올 한국어 특화 임베딩 모델 이름
EMBEDDING_MODEL = "jhgan/ko-sroberta-multitask"
# [주석] LLM(Groq)이 답변을 생성할 때의 '창의성' 수치. 0에 가까울수록 사실 기반, 높을수록 창의적입니다.
LLM_TEMPERATURE = 0.7

logger.info("임베딩 모델을 로드합니다...")
# [주석] 문장(질문)을 벡터(숫자 배열)로 변환해주는 임베딩 모델을 로드합니다.
embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)

# --- 2. 전문가 에이전트 클래스 정의 ---
# [주석] 'BaseExpertAgent'는 '작물', '레시피', '영양' 전문가의 공통 기능을 정의하는 '설계도' 또는 '템플릿'입니다.
class BaseExpertAgent:
    """각 전문가 AI의 워크플로우와 기능을 정의하는 클래스"""
    # [주석] 이 클래스의 인스턴스(객체)가 생성될 때 (예: farmer_agent = ...) 처음 실행되는 함수입니다.
    def __init__(self, name: str, collection_name: str, persona_prompt: str):
        self.name = name # [주석] 에이전트 이름 (예: "작물 전문가")
        self.collection_name = collection_name # [주석] Milvus에서 사용할 컬렉션 이름 (예: "farmer")
        self.persona_prompt = persona_prompt # [주석] 이 에이전트의 역할 정의 (예: "너는 작물 전문가야...")
        
        # [주석] 이 에이전트만의 작은 워크플로우(그래프)를 생성합니다. (rewriter -> retriever -> generator)
        self.workflow = self._build_workflow()
        
        logger.info(f"[{self.name}] Milvus에 연결하고 '{self.collection_name}' 컬렉션을 로드합니다...")
        try:
            # [주석] Milvus에 아직 연결 안 됐으면, 기본 연결을 생성합니다.
            if not connections.has_connection("default"):
                connections.connect("default", host=MILVUS_HOST, port=MILVUS_PORT)
            # [주석] Milvus에서 이 에이전트가 사용할 컬렉션(테이블)을 지정합니다.
            self.collection = Collection(self.collection_name)
            # [주석] Milvus 컬렉션을 메모리에 로드하여 검색 속도를 빠르게 합니다.
            self.collection.load()
            logger.info(f"[{self.name}] '{self.collection_name}' 컬렉션 로드 완료.")
        except Exception as e:
            logger.error(f"[{self.name}] Milvus 컬렉션을 로드할 수 없습니다: {e}")
            raise e # [주석] 오류 발생 시 프로그램을 중단시킵니다.

    # [흐름] 1. (에이전트별) 질문 재작성
    async def _rewrite_query(self, state: dict) -> dict:
        """대화 기록을 바탕으로 사용자의 마지막 질문을 '검색용 질문'으로 재작성하거나, 관련 없으면 'pass'를 반환합니다."""
        messages = state['messages'] # [주석] 전체 대화 기록
        last_message = messages[-1] # [주석] 사용자의 가장 최근 질문
        # [주석] 대화 기록을 문자열로 변환합니다. (마지막 질문 제외)
        history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in messages[:-1]])
        
        # [주석] 이 에이전트(예: 작물 전문가)의 역할에 맞춘 프롬프트를 생성합니다.
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

        # [주석] Groq API에 '질문 재작성'을 요청합니다. (빠른 8b 모델 사용)
        chat_completion = await async_groq_client.chat.completions.create(
            messages=[{"role": "user", "content": rewrite_prompt}],
            model="llama-3.1-8b-instant",
            temperature=0.0 # [주석] 창의성 0: 프롬프트 지시를 가장 정확하게 따르도록 설정
        )
        # [주석] LLM의 답변(재작성된 질문 또는 "pass")을 가져옵니다.
        rewritten_query = chat_completion.choices[0].message.content.strip()
        logger.info(f"[{self.name}] 재작성된 질문: {rewritten_query}")
        # [주석] 상태(state)를 업데이트하여 다음 노드로 전달합니다.
        return {**state, "rewritten_query": rewritten_query}

    # [흐름] 2. (에이전트별) Milvus DB 검색
    async def _retrieve(self, state: dict) -> dict:
        """재작성된 질문을 벡터로 변환하여 Milvus DB에서 관련 문서를 검색합니다."""
        rewritten_query = state['rewritten_query']
        # [주석] 이전 단계(_rewrite_query)에서 "pass"가 반환됐으면, 검색을 건너뜁니다.
        if rewritten_query == "pass":
            logger.info(f"[{self.name}] 전문 분야와 관련 없어 Retriever를 건너뜁니다.")
            return {**state, "documents": []} # [주석] 빈 문서 리스트를 반환합니다.

        logger.info(f"[{self.name}] Retriever 실행 (검색 질문: '{rewritten_query[:30]}...')")
        # [주석] 재작성된 질문(텍스트)을 임베딩 모델을 사용해 벡터(숫자 배열)로 변환합니다.
        query_vector = embeddings.embed_query(rewritten_query)
        search_params = {"metric_type": "L2", "params": {"nprobe": 10}} # [주석] Milvus 검색 옵션
        
        # [주석] Milvus 컬렉션에 벡터 검색을 실행합니다. (limit=3: 최대 3개 결과)
        results = self.collection.search(data=[query_vector], anns_field="vector", param=search_params, limit=3, output_fields=["text", "source", "page"])
        
        # [주석] 검색 결과를 LangChain이 이해할 수 있는 'Document' 객체 리스트로 변환합니다.
        retrieved_docs = [Document(page_content=hit.entity.get('text')) for hit in results[0]] if results and results[0] else []
        logger.info(f"[{self.name}] 검색된 문서 {len(retrieved_docs)}개")
        # [주석] 검색된 문서 리스트를 상태(state)에 추가하여 다음 노드로 전달합니다.
        return {**state, "documents": retrieved_docs}

    # [흐름] 3. (에이전트별) 답변 생성
    async def _generate(self, state: dict) -> dict:
        """검색된 문서를 바탕으로 전문가의 '의견 요약'을 생성합니다."""
        # [주석] 관련 없는("pass") 질문이거나 검색 결과가 없으면, 답변 생성을 건너뜁니다.
        if state['rewritten_query'] == "pass" or not state['documents']:
             logger.info(f"[{self.name}] 생성할 정보가 없어 Generator를 건너뜁니다.")
             return {**state, "generation": ""} # [주석] 빈 답변을 반환합니다.

        logger.info(f"[{self.name}] Generator 실행")
        # [주석] 검색된 문서들의 텍스트를 하나로 합쳐 '참고 정보(context)'를 만듭니다.
        context = "\n\n".join([doc.page_content for doc in state['documents']])
        
        # [주석] 이 에이전트가 참고 정보(context)를 요약하기 위한 프롬프트를 생성합니다.
        prompt = f"""당신은 '{self.name}'입니다. 주어진 [참고 정보]만을 사용하여 [검색용 질문]에 대한 답변의 '핵심 내용'만 간결하게 요약하세요.

[참고 정보]
{context}

[검색용 질문]
{state['rewritten_query']}

[핵심 내용 요약]"""
        api_messages = [{"role": "user", "content": prompt}]
        # [주석] Groq API에 '내용 요약'을 요청합니다. (빠른 8b 모델 사용)
        chat_completion = await async_groq_client.chat.completions.create(messages=api_messages, model="llama-3.1-8b-instant", temperature=0.0)
        # [주석] LLM이 생성한 '요약 답변'을 가져옵니다.
        generation = chat_completion.choices[0].message.content
        # [주석] 생성된 요약 답변을 상태(state)에 추가하여 반환합니다.
        return {**state, "generation": generation}

    def _build_workflow(self):
        """이 에이전트(farmer, recipe, nutrient) 내부에서 사용될 미니 워크플로우를 구축합니다."""
        workflow = StateGraph(dict)
        # [주석] 이 에이전트의 3가지 단계(노드)를 그래프에 추가합니다.
        workflow.add_node("rewriter", self._rewrite_query)
        workflow.add_node("retriever", self._retrieve)
        workflow.add_node("generator", self._generate)
        
        # [주석] 시작점을 'rewriter'로 설정합니다.
        workflow.set_entry_point("rewriter")
        
        # [주석] 노드 간의 흐름을 정의합니다: rewriter -> retriever -> generator
        workflow.add_edge("rewriter", "retriever")
        workflow.add_edge("retriever", "generator")
        # [주석] 'generator' 노드가 실행되면 이 미니 워크플로우는 종료(END)됩니다.
        workflow.add_edge("generator", END)
        
        # [주석] 정의된 워크플로우를 '컴파일'하여 실행 가능한 객체로 만듭니다.
        return workflow.compile()

    async def run(self, messages: List[BaseMessage]):
        """이 에이전트의 워크플로우를 외부에서 호출(실행)하기 위한 함수입니다."""
        # [주석] 'ainvoke'를 사용해 이 에이전트의 미니 워크플로우(self.workflow)를 비동기로 실행합니다.
        return await self.workflow.ainvoke({"messages": messages})

# --- 3. 메타 에이전트 및 메인 워크플로우 정의 ---
# [주석] 'MetaAgentState'는 전체 챗봇 애플리케이션이 공유하는 '메인 상태'입니다.
class MetaAgentState(TypedDict):
    # [주석] 사용자와 챗봇 간의 전체 대화 기록 (HumanMessage, AIMessage 리스트)
    messages: List[BaseMessage]
    # [주석] 각 전문가 에이전트가 생성한 '요약 답변'을 저장하는 딕셔너리 (예: {"작물 전문가": "...", "레시피 전문가": "..."})
    expert_responses: Dict[str, str]
    # [주석] LLM 라우터가 분류한 결과(경로)를 저장합니다. (예: "farmer_recipe" 또는 "general")
    route: str

# [메인 흐름] 1. LLM 라우터 (질문 분류)
async def llm_router_node(state: MetaAgentState) -> dict:
    """[핵심] LLM을 사용하여 사용자의 질문 의도를 분석하고, 필요한 전문가(들)를 결정(라우팅)합니다."""
    logger.info("\n--- LLM 라우터 실행: 사용자 질문 의도 분석 (조합 허용) ---")
    question = state["messages"][-1].content # [주석] 사용자의 최신 질문
    history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in state["messages"][:-1]])
    
    # [주석] 우리가 생성한 3명 전문가의 이름과 역할을 LLM에게 알려주기 위해 문자열을 만듭니다.
    expert_definitions = "\n".join([f"- {agent.name}: {agent.persona_prompt}" for agent in expert_agents.values()])
    
    # [주석] LLM이 질문을 '분류(라우팅)'하도록 지시하는 프롬프트입니다.
    routing_prompt = f"""당신은 사용자의 질문 의도를 분석하여 'farmer'(농업), 'recipe'(요리), 'nutrient'(영양) 중 필요한 전문가를 모두 선택하여 분류하는 지능형 라우터입니다.

[사용 가능한 전문가 목록]
{expert_definitions}

[대화 기록]
{history_str}

[사용자 질문]
{question}

[지침]
1. [사용자 질문]과 [대화 기록]을 종합적으로 고려하여 질문의 핵심 의도를 파악하세요.
2. 파악한 의도에 가장 적합한 전문가를 'farmer', 'recipe', 'nutrient' 중에서 하나 이상 선택하세요.
3. 관련 전문가가 없으면 'general'이라고 응답하세요.
4. 둘 이상 관련되면 쉼표로 구분하여 모두 나열하세요 (예: 'farmer, nutrient').

[절대 규칙]
- 당신의 최종 출력은 오직 'farmer', 'recipe', 'nutrient', 'general' 또는 이들의 쉼표 조합(예: 'farmer, recipe')이어야 합니다.
- 절대 당신의 분석 과정, 설명, 다른 문장을 포함해서는 안 됩니다.

[실제 분류 결과]:"""
    try:
        # [주석] Groq API에 '질문 분류'를 요청합니다. (빠른 8b 모델 사용)
        chat_completion = await async_groq_client.chat.completions.create(
            messages=[{"role": "user", "content": routing_prompt}],
            model="llama-3.1-8b-instant", 
            temperature=0.0
        )
        # [주석] LLM의 분류 결과 (예: "farmer, recipe")를 가져옵니다.
        intent = chat_completion.choices[0].message.content.strip().lower()
        
        # [주석] LLM의 분류 결과(intent)를 분석하여 필요한 전문가를 파악합니다.
        needs_farmer = "farmer" in intent or "작물" in intent
        needs_recipe = "recipe" in intent or "레시피" in intent
        needs_nutrient = "nutrient" in intent or "영양" in intent

        route_parts = []
        if needs_farmer: route_parts.append("farmer")
        if needs_recipe: route_parts.append("recipe")
        if needs_nutrient: route_parts.append("nutrient")
        
        # [주석] 필요한 전문가가 없거나 'general'이면 "general" 경로로,
        if not route_parts or "general" in intent:
            route = "general"
        else:
            # [주석] 그 외에는 알파벳 순으로 정렬된 경로 이름을 만듭니다. (예: "farmer_recipe")
            route = "_".join(sorted(route_parts)) 
            
        logger.info(f"라우팅 결정: '{route}' 경로로 진행")
        
        # [주석] 사용자(개발자)가 콘솔에서 현재 상태를 쉽게 파악할 수 있도록 print문을 추가합니다.
        print(f"\n[라우터 알림] 사용자의 질문을 '{route}' 경로로 분류하여 전문가를 실행합니다.")
        
        # [주석] 메인 상태(MetaAgentState)의 'route' 값을 업데이트합니다.
        return {"route": route}
    except Exception as e:
        # [주석] LLM 라우팅 실패 시(예: API 오류), 안전하게 'general' 경로로 보냅니다.
        logger.error(f"라우팅 중 오류 발생: {e}, 'general' 경로로 진행합니다.")
        print(f"\n[라우터 알림] 라우팅 중 오류가 발생하여 'general' 경로로 진행합니다.")
        return {"route": "general"}

# [메인 흐름] 2. (경로별) 전문가 실행
# [주석] 아래 8개의 'run_...' 함수들은 'add_conditional_edges'에 의해 8개 경로 중 '하나만' 실행됩니다.

async def run_general_node(state: MetaAgentState) -> dict:
    """경로: "general" (관련 전문가 없음)"""
    logger.info("\n>> 'general' 경로 실행 (관련 전문가 없음)")
    return {"expert_responses": {}} # [주석] 빈 답변을 반환합니다.

async def run_farmer_expert_node(state: MetaAgentState) -> dict:
    """경로: "farmer" (작물 전문가만 실행)"""
    logger.info(f"\n>> {farmer_agent.name} 단독 실행...")
    result = await farmer_agent.run(state['messages']) # [주석] 작물 에이전트의 미니 워크플로우 실행
    return {"expert_responses": {farmer_agent.name: result.get("generation", "")}}

async def run_recipe_expert_node(state: MetaAgentState) -> dict:
    """경로: "recipe" (레시피 전문가만 실행)"""
    logger.info(f"\n>> {recipe_agent.name} 단독 실행...")
    result = await recipe_agent.run(state['messages'])
    return {"expert_responses": {recipe_agent.name: result.get("generation", "")}}

async def run_nutrient_expert_node(state: MetaAgentState) -> dict:
    """경로: "nutrient" (영양 전문가만 실행)"""
    logger.info(f"\n>> {nutrient_agent.name} 단독 실행...")
    result = await nutrient_agent.run(state['messages'])
    return {"expert_responses": {nutrient_agent.name: result.get("generation", "")}}

async def run_farmer_recipe_node(state: MetaAgentState) -> dict:
    """경로: "farmer_recipe" (작물, 레시피 전문가 '병렬' 실행)"""
    logger.info(f"\n>> {farmer_agent.name}와 {recipe_agent.name} 병렬 실행...")
    # [주석] asyncio.gather: 두 전문가의 'run' 함수를 '동시에' 실행하고, 두 결과가 모두 올 때까지 기다립니다.
    results = await asyncio.gather(
        farmer_agent.run(state['messages']),
        recipe_agent.run(state['messages'])
    )
    # [주석] 두 전문가의 답변을 'expert_responses'에 합쳐서 반환합니다.
    return {"expert_responses": {
        farmer_agent.name: results[0].get("generation", ""),
        recipe_agent.name: results[1].get("generation", "")
    }}

async def run_farmer_nutrient_node(state: MetaAgentState) -> dict:
    """경로: "farmer_nutrient" (작물, 영양 전문가 '병렬' 실행)"""
    logger.info(f"\n>> {farmer_agent.name}와 {nutrient_agent.name} 병렬 실행...")
    results = await asyncio.gather(
        farmer_agent.run(state['messages']),
        nutrient_agent.run(state['messages'])
    )
    return {"expert_responses": {
        farmer_agent.name: results[0].get("generation", ""),
        nutrient_agent.name: results[1].get("generation", "")
    }}

async def run_recipe_nutrient_node(state: MetaAgentState) -> dict:
    """경로: "recipe_nutrient" (레시피, 영양 전문가 '병렬' 실행)"""
    logger.info(f"\n>> {recipe_agent.name}와 {nutrient_agent.name} 병렬 실행...")
    results = await asyncio.gather(
        recipe_agent.run(state['messages']),
        nutrient_agent.run(state['messages'])
    )
    return {"expert_responses": {
        recipe_agent.name: results[0].get("generation", ""),
        nutrient_agent.name: results[1].get("generation", "")
    }}

async def run_all_experts_node(state: MetaAgentState) -> dict:
    """경로: "farmer_recipe_nutrient" (3명 전문가 모두 '병렬' 실행)"""
    logger.info(f"\n>> 3명 전문가({farmer_agent.name}, {recipe_agent.name}, {nutrient_agent.name}) 병렬 실행...")
    results = await asyncio.gather(
        farmer_agent.run(state['messages']),
        recipe_agent.run(state['messages']),
        nutrient_agent.run(state['messages'])
    )
    return {"expert_responses": {
        farmer_agent.name: results[0].get("generation", ""),
        recipe_agent.name: results[1].get("generation", ""),
        nutrient_agent.name: results[2].get("generation", "")
    }}

# [메인 흐름] 3. LLM Synthesizer (답변 종합)
async def synthesize_final_answer_node(state: MetaAgentState) -> dict:
    """[핵심] 모든 전문가의 답변(들)을 취합하여, 하나의 자연스러운 최종 답변을 생성합니다."""
    logger.info("\n--- Synthesizer 실행: 답변 종합 ---")
    messages = state['messages'] # [주석] 전체 대화 기록
    expert_responses = state['expert_responses'] # [주석] 이번 턴에 실행된 전문가들의 답변
    
    context = ""
    # [주석] 전문가 답변이 있는 경우에만 'context' 문자열을 만듭니다.
    for name, response in expert_responses.items():
        if response:
            context += f"### {name}의 의견\n{response}\n\n"
            
    # [주석] 'general' 경로였거나, 전문가가 답변 생성에 실패한 경우
    if not context:
        final_answer = "죄송하지만, 문의하신 내용과 관련된 정보를 찾지 못했습니다. 좀 더 구체적인 작물, 요리 또는 영양 성분 이름으로 질문해주시겠어요?"
    else:
        # [주석] LLM이 여러 전문가의 의견을 '자연스럽게 종합'하도록 지시하는 프롬프트입니다.
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
- **언어 순수성 (매우 중요)**: 최종 답변은 **오직 순수 한글**으로만 작성되어야 합니다.
- **품종 이름 일반화**: '설향' 같은 품종 이름은 대표 작물 이름인 '딸기' 등으로 바꿔서 설명해야 합니다. (농업 관련 내용일 경우)
- **형식 엄수**: 마크다운 서식(##, *, 1. 등)은 절대 사용하지 마세요.

[실제 작업]
[최종 답변]"""
        
        # [주석] Groq API에 '최종 답변 종합'을 요청합니다. (요청대로 8b 모델 사용)
        chat_completion = await async_groq_client.chat.completions.create(
            messages=[{"role": "user", "content": synth_prompt}],
            model="llama-3.1-8b-instant", 
            temperature=LLM_TEMPERATURE # [주석] 답변 종합은 약간의 창의성을 허용합니다.
        )
        final_answer = chat_completion.choices[0].message.content

    # [주석] 최종 답변(final_answer)을 'AIMessage'(챗봇 답변) 객체로 만들어,
    # [주석] 전체 대화 기록(messages)에 추가하고 상태를 업데이트합니다.
    final_messages = messages + [AIMessage(content=final_answer)]
    return {**state, "messages": final_messages}


# [메인 흐름] A. 챗봇 초기화
# [주석] 이 스크립트(test.py)가 직접 실행되었을 때만 아래 코드가 동작합니다.
if __name__ == "__main__":
    # [주석] 위에서 정의한 'BaseExpertAgent' 클래스(설계도)를 사용해 3명의 실제 전문가 에이전트(객체)를 생성합니다.
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
    nutrient_agent = BaseExpertAgent(
        name="영양 전문가",
        collection_name="nutrient", 
        persona_prompt="식품의 영양 성분, 칼로리, 건강 효과를 정확하게 분석해주는 'AI 식품 영양 전문가'입니다."
    )
    
    # [주석] 3명의 전문가를 딕셔너리(사전) 형태로 관리합니다. (라우터 프롬프트 생성 시 사용)
    expert_agents = { 
        "작물 전문가": farmer_agent, 
        "레시피 전문가": recipe_agent,
        "영양 전문가": nutrient_agent 
    }

    # [메인 흐름] B. 메인 워크플로우(그래프) 정의
    # [주석] 전체 챗봇의 흐름을 정의할 '메인 그래프'를 생성합니다. (메인 상태: MetaAgentState)
    main_workflow = StateGraph(MetaAgentState)
    
    # [주석] 그래프에 필요한 모든 '단계(노드)'를 추가합니다.
    # [주석] 1. LLM 라우터 (분류기)
    main_workflow.add_node("router", llm_router_node) 
    
    # [주석] 2. 8개의 실행 경로 (단일 3 + 조합 3 + 전체 1 + 일반 1)
    main_workflow.add_node("run_general", run_general_node)
    main_workflow.add_node("run_farmer", run_farmer_expert_node)
    main_workflow.add_node("run_recipe", run_recipe_expert_node)
    main_workflow.add_node("run_nutrient", run_nutrient_expert_node)
    main_workflow.add_node("run_farmer_recipe", run_farmer_recipe_node)
    main_workflow.add_node("run_farmer_nutrient", run_farmer_nutrient_node)
    main_workflow.add_node("run_recipe_nutrient", run_recipe_nutrient_node)
    main_workflow.add_node("run_farmer_recipe_nutrient", run_all_experts_node)
    
    # [주석] 3. LLM Synthesizer (답변 종합기)
    main_workflow.add_node("synthesizer", synthesize_final_answer_node)

    # [주석] 챗봇의 '시작점'을 'router' 노드로 설정합니다. (모든 질문은 router로 시작)
    main_workflow.set_entry_point("router")
    
    # [주석] [핵심] '조건부 엣지(연결선)'를 설정합니다.
    main_workflow.add_conditional_edges(
        "router", # [주석] 'router' 노드가 끝난 뒤에,
        lambda state: state["route"], # [주석] 메인 상태(state)의 'route' 값(예: "farmer_recipe")을 확인하여
        {
            # [주석] 'route' 값에 따라 다음에 실행할 노드를 결정합니다.
            "general": "run_general",
            "farmer": "run_farmer", 
            "recipe": "run_recipe", 
            "nutrient": "run_nutrient",
            "farmer_recipe": "run_farmer_recipe",
            "farmer_nutrient": "run_farmer_nutrient",
            "recipe_nutrient": "run_recipe_nutrient",
            "farmer_recipe_nutrient": "run_farmer_recipe_nutrient"
        }
    )
    
    # [주석] 8개의 실행 노드는 *모두* 'synthesizer' 노드로 연결됩니다.
    main_workflow.add_edge("run_general", "synthesizer")
    main_workflow.add_edge("run_farmer", "synthesizer")
    main_workflow.add_edge("run_recipe", "synthesizer")
    main_workflow.add_edge("run_nutrient", "synthesizer")
    main_workflow.add_edge("run_farmer_recipe", "synthesizer")
    main_workflow.add_edge("run_farmer_nutrient", "synthesizer")
    main_workflow.add_edge("run_recipe_nutrient", "synthesizer")
    main_workflow.add_edge("run_farmer_recipe_nutrient", "synthesizer")
    
    # [주석] 'synthesizer' 노드가 끝나면 워크플로우를 종료(END)합니다.
    main_workflow.add_edge("synthesizer", END)
    
    # [주석] 정의된 그래프를 컴파일하여 실행 가능한 'app' 객체를 생성합니다.
    app = main_workflow.compile()
    
    # [주석] 그래프 구조를 PNG 이미지 파일로 저장하여 시각적으로 확인할 수 있게 합니다.
    try:
        graph_image_path = "main_workflow_v5_fix.png" 
        with open(graph_image_path, "wb") as f:
            f.write(app.get_graph().draw_mermaid_png())
        logger.info(f"메인 워크플로우 구조가 '{graph_image_path}' 파일로 저장되었습니다.")
    except Exception as e:
        logger.warning(f"그래프 시각화 중 외부 API 접속에 실패했습니다 (챗봇 기능에 영향 없음).")

    # [메인 흐름] C. 챗봇 실행 루프
    # [주석] 챗봇 시작 안내 메시지를 출력합니다.
    print("\n" + "="*70)
    print(" AI 농업 & 요리 & 영양 전문가 (V7.6 조합 경로 복구) ".center(70, "="))
    # [주석] 오타 수정 ('7E' -> '70')
    print("="*70)
    print("안녕하세요! 작물, 레시피, 영양 성분 등 무엇이든 물어보세요.")
    print("-" * 70)
    
    # [주석] 챗봇의 '메인 상태'를 빈 리스트로 초기화합니다.
    current_state = {"messages": []}

    # [주석] 챗봇의 메인 실행 로직을 담은 비동기 함수입니다.
    async def chat_loop():
        while True: # [주석] 사용자가 '종료'를 입력할 때까지 무한 반복합니다.
            # [주석] 사용자 입력을 비동기적으로 받습니다. (입력 대기 중 다른 작업 가능)
            user_input = await asyncio.to_thread(input, "나: ")
            if user_input.lower() == '종료':
                print("챗봇: 대화를 종료합니다.")
                break # [주석] 반복문(while)을 탈출합니다.

            # [주석] 사용자 입력을 'HumanMessage' 객체로 만들어 대화 기록(messages)에 추가합니다.
            current_state["messages"].append(HumanMessage(content=user_input))
            
            try:
                # [주석] [핵심] 'app.ainvoke'로 LangGraph 그래프 전체를 실행합니다.
                # [주석] (router -> (병렬)run_... -> synthesizer)
                final_state = await app.ainvoke(current_state)
                
                # [주석] 그래프 실행이 완료되면, 'final_state'의 최신 대화 기록으로 'current_state'를 업데이트합니다.
                current_state["messages"] = final_state["messages"]
                
                # [주석] 챗봇의 '최종 답변' (AIMessage)을 가져옵니다.
                final_bot_message = current_state["messages"][-1]
                
                # [주석] 챗봇이 타이핑하는 것처럼 보이도록 답변을 한 글자씩 출력합니다.
                print(f"챗봇: ", end="", flush=True)
                for char in final_bot_message.content:
                    print(char, end="", flush=True)
                    await asyncio.sleep(0.02) # [주석] 0.02초 대기
                print("\n" + "-"*70)

            except Exception as e:
                # [주석] 그래프 실행 중 오류 발생 시
                logger.error(f"메인 루프에서 오류 발생: {e}", exc_info=True)
                if current_state["messages"]:
                    # [주석] 오류가 발생했으므로, 방금 추가한 사용자 입력을 대화 기록에서 제거(롤백)합니다.
                    current_state["messages"].pop() 

    # [주석] 비동기 'chat_loop' 함수를 실행합니다.
    # [주석] 오타 수정 ('asyncIO' -> 'asyncio')
    asyncio.run(chat_loop())