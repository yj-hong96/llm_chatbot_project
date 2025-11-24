# [개요] 농업·요리·영양 3개 전문가 에이전트를 LLM 라우터로 동적 선택·병렬 검색 후 근거 기반 한국어 답변을 합성하는 콘솔용 LangGraph 앱입니다.

import os  # OS 환경 접근(예: env 변수·경로)
import re  # 정규식 유틸(현재 직접 사용은 적음)
import time  # 시간 유틸(지연·측정 등)
import asyncio  # 비동기 실행(LLM 호출/검색 병렬 처리)
import logging  # 로깅 구성 및 출력
from dotenv import load_dotenv  # .env 환경변수 로드
from groq import Groq, AsyncGroq, RateLimitError  # Groq LLM 클라이언트/예외
from typing import TypedDict, List, Literal, Dict  # 타입 힌트용
from langchain_core.messages import HumanMessage, AIMessage, BaseMessage  # 메시지 타입
from langchain_core.documents import Document  # 검색 결과 문서 컨테이너
from langchain_huggingface import HuggingFaceEmbeddings  # HF 임베딩
from pymilvus import connections, Collection  # Milvus 연결/컬렉션
from langgraph.graph import StateGraph, END  # 상태 그래프 구성요소



# --- 1. 로깅 및 초기 설정 ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')  # 표준 로깅 포맷/레벨 설정
logger = logging.getLogger(__name__)  # 모듈 로거 획득

load_dotenv()  # .env 파일에서 API 키 등 환경 변수 로드
try:
    async_groq_client = AsyncGroq()  # 비동기 Groq 클라이언트 초기화(환경변수 기반)
except Exception as e:
    logger.error(f"Groq 클라이언트를 초기화할 수 없습니다: {e}")  # 초기화 실패 로깅
    exit()  # 치명적 오류 시 종료

MILVUS_HOST = "localhost"  # Milvus 호스트 주소
MILVUS_PORT = "19530"  # Milvus 포트
EMBEDDING_MODEL = "jhgan/ko-sroberta-multitask"  # 한국어 멀티태스크 임베딩 모델
LLM_TEMPERATURE = 0.7  # 답변 다양성 제어 온도

logger.info("임베딩 모델을 로드합니다...")  # 임베딩 로딩 알림
embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)  # HuggingFace 임베딩 인스턴스 생성

# --- 2. 전문가 에이전트 클래스 정의 ---
class BaseExpertAgent:
    """각 전문가 AI의 워크플로우와 기능을 정의하는 클래스"""  # 공통 로직(질문재작성→검색)을 캡슐화

    def __init__(self, name: str, collection_name: str, persona_prompt: str):
        self.name = name  # 에이전트 표시용 이름
        self.collection_name = collection_name  # Milvus 컬렉션명
        self.persona_prompt = persona_prompt  # 역할/전문영역 서술 프롬프트
        self.workflow = self._build_workflow()  # LangGraph 워크플로우 구성

        logger.info(f"[{self.name}] Milvus에 연결하고 '{self.collection_name}' 컬렉션을 로드합니다...")  # 연결 로그
        try:
            if not connections.has_connection("default"):  # 기본 연결 존재 확인
                connections.connect("default", host=MILVUS_HOST, port=MILVUS_PORT)  # Milvus 연결 생성
            self.collection = Collection(self.collection_name)  # 대상 컬렉션 핸들 획득
            self.collection.load()  # 검색 대비 컬렉션 메모리 로드
            logger.info(f"[{self.name}] '{self.collection_name}' 컬렉션 로드 완료.")  # 성공 로그
        except Exception as e:
            logger.error(f"[{self.name}] Milvus 컬렉션을 로드할 수 없습니다: {e}")  # 실패 로그
            raise e  # 상위로 에러 전파

    async def _rewrite_query(self, state: dict) -> dict:
        messages = state['messages']  # 현재까지의 대화 메시지
        last_message = messages[-1]  # 최신 사용자 메시지
        history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in messages[:-1]])  # 히스토리 텍스트화

        # LLM 프롬프트: 전문성 관련성 판단 후 검색 최적화 질문 1줄 산출 또는 "pass" 반환
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
            messages=[{"role": "user", "content": rewrite_prompt}],  # 단일 유저 프롬프트로 호출
            model="llama-3.1-8b-instant",  # 경량·고속 모델로 쿼리 재작성
            temperature=0.0  # 결정적 출력 유도
        )
        rewritten_query = chat_completion.choices[0].message.content.strip()  # LLM 응답에서 재작성 쿼리 추출
        logger.info(f"[{self.name}] 재작성된 질문: {rewritten_query}")  # 재작성 결과 로깅
        return {**state, "rewritten_query": rewritten_query}  # 상태에 재작성 쿼리 추가

    async def _retrieve(self, state: dict) -> dict:
        rewritten_query = state['rewritten_query']  # 재작성된 검색 질의
        if rewritten_query == "pass":
            logger.info(f"[{self.name}] 전문 분야와 관련 없어 Retriever를 건너뜁니다.")  # 비관련 시 검색 생략
            return {**state, "documents": []}  # 공백 문서 반환

        logger.info(f"[{self.name}] Retriever 실행 (검색 질문: '{rewritten_query[:30]}...')")  # 검색 시작 로그
        query_vector = embeddings.embed_query(rewritten_query)  # 텍스트→벡터 변환
        search_params = {"metric_type": "L2", "params": {"nprobe": 10}}  # Milvus 검색 파라미터(L2 거리, nprobe=10)
        results = self.collection.search(data=[query_vector], anns_field="vector", param=search_params, limit=3, output_fields=["text", "source", "page"])  # top-3 검색
        retrieved_docs = [Document(page_content=hit.entity.get('text')) for hit in results[0]] if results and results[0] else []  # 결과를 Document 리스트로 정규화
        logger.info(f"[{self.name}] 검색된 문서 {len(retrieved_docs)}개")  # 검색 결과 개수 로깅
        return {**state, "documents": retrieved_docs}  # 상태에 문서 리스트 추가

    def _build_workflow(self):
        workflow = StateGraph(dict)  # 간단한 dict 상태를 쓰는 서브그래프 생성
        workflow.add_node("rewriter", self._rewrite_query)  # 쿼리 재작성 노드 등록
        workflow.add_node("retriever", self._retrieve)  # 검색 노드 등록
        workflow.set_entry_point("rewriter")  # 진입점은 재작성
        workflow.add_edge("rewriter", "retriever")  # 재작성→검색 순서 연결
        workflow.add_edge("retriever", END)  # 검색 후 종료
        return workflow.compile()  # 서브그래프 컴파일

    async def run(self, messages: List[BaseMessage]):
        return await self.workflow.ainvoke({"messages": messages})  # 메시지를 입력으로 비동기 워크플로우 실행

# --- 3. 메타 에이전트 및 메인 워크플로우 정의 ---
class MetaAgentState(TypedDict):
    messages: List[BaseMessage]  # 대화 히스토리(누적)
    expert_docs: dict  # 전문가별 검색 문서 모음
    # ====[수정된 부분 1: 상태 변경]====
    # 라우터의 결정(예: "farmer")을 저장하는 'route' 대신,
    # 실행할 전문가 목록(예: ["작물 전문가", "영양 전문가"])을 저장하는 'experts_to_run'을 사용합니다.
    experts_to_run: List[str]  # 실행 대상 전문가 이름 리스트

# ====[수정된 부분 2: 지능형 LLM 라우터로 업그레이드]====
# 기존의 정적(farmer, recipe, both) 라우터를
# LLM이 동적으로 전문가 목록을 생성하는 방식으로 변경합니다.
async def llm_router_node(state: MetaAgentState) -> dict:
    """LLM을 사용하여 사용자의 질문 의도를 분석하고 필요한 전문가 목록을 결정합니다."""  # 동적 라우팅 노드

    logger.info("\n--- LLM 라우터 실행: 사용자 질문 의도 분석 ---")  # 라우터 시작 로그
    question = state["messages"][-1].content  # 최신 사용자 질문 추출
    history_str = "\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in state["messages"][:-1]])  # 과거 대화 문자열화

    # 이제 expert_agents 딕셔너리에서 동적으로 전문가 목록을 불러옵니다.
    expert_definitions = "\n".join([f"- {agent.name}: {agent.persona_prompt}" for agent in expert_agents.values()])  # 사용 가능 전문가 목록 구성

    # 라우팅 프롬프트: 의도 분석→적합 전문가 이름들을 콤마로 출력(설명 금지)
    routing_prompt = f"""당신은 사용자의 질문을 분석하여, 어떤 전문가가 필요한지 결정하는 지능형 라우터입니다.

[사용 가능한 전문가 목록]
{expert_definitions}

[대화 기록]
{history_str}

[사용자 질문]
{question}

[지침]
1. [사용자 질문]과 [대화 기록]을 종합적으로 고려하여 질문의 핵심 의도를 파악하세요.
2. 파악한 의도에 가장 적합한 전문가를 [사용 가능한 전문가 목록]에서 모두 선택하세요.
3. 선택된 전문가들의 이름 목록을 쉼표(,)로 구분하여 한 줄로 출력하세요.
4. 만약 어떤 전문가가 적합한지 판단하기 어렵다면, 모든 전문가의 이름을 출력하세요.

[절대 규칙]
- 당신의 최종 출력은 오직 전문가 이름 목록이어야 합니다. (예: 작물 전문가,레시피 전문가)
- 절대 당신의 분석 과정, 설명, 다른 문장을 포함해서는 안 됩니다.

[실제 분류 결과]:"""
    try:
        chat_completion = await async_groq_client.chat.completions.create(
            messages=[{"role": "user", "content": routing_prompt}],  # 라우팅 전용 프롬프트 전송
            model="llama-3.1-8b-instant",  # 빠른 분류용 모델
            temperature=0.0  # 결정적 선택 유도
        )
        selected_experts_str = chat_completion.choices[0].message.content.strip()  # 응답 문자열(전문가 목록)
        # LLM의 출력에서 유효한 전문가 이름만 필터링
        selected_experts = [name.strip() for name in selected_experts_str.split(',') if name.strip() in expert_agents]  # 사전 검증으로 견고화

        if not selected_experts:
            logger.warning("라우터가 유효한 전문가를 선택하지 못했습니다. 모든 전문가를 호출합니다.")  # 공백 결과 폴백
            selected_experts = list(expert_agents.keys())  # 전체 호출

        logger.info(f"라우팅 결정: {selected_experts} 호출")  # 최종 라우팅 로그
        return {"experts_to_run": selected_experts}  # 다음 노드 입력 반환
    except Exception as e:
        logger.error(f"라우팅 중 오류 발생: {e}, 모든 전문가를 호출합니다.")  # 예외 시 폴백
        return {"experts_to_run": list(expert_agents.keys())}  # 전체 호출 반환

# ====[수정된 부분 3: 동적 병렬 실행 노드]====
# 'run_farmer', 'run_recipe', 'run_both' 노드를 하나로 통합하여
# 라우터가 결정한 전문가 목록(experts_to_run)에 따라 동적으로 병렬 실행합니다.
async def run_selected_experts_node(state: MetaAgentState) -> dict:
    """라우터가 선택한 전문가 에이전트들을 병렬로 실행합니다."""  # 병렬 실행 및 결과 모음

    experts_to_run = state['experts_to_run']  # 실행 대상 목록
    messages = state['messages']  # 전체 대화(질의·컨텍스트)

    tasks = []  # asyncio.gather용 작업 리스트
    valid_experts_to_run = []  # 유효한 이름만 저장
    for expert_name in experts_to_run:
        if expert_name in expert_agents:  # 등록 여부 확인
            logger.info(f"\n>> {expert_name} 실행...")  # 실행 로그
            tasks.append(expert_agents[expert_name].run(messages))  # 각 에이전트 서브그래프 실행 태스크 생성
            valid_experts_to_run.append(expert_name)  # 이름 기록

    if not tasks:
        logger.info("실행할 전문가가 없습니다.")  # 방어 코드
        return {"expert_docs": {}}  # 빈 결과

    # 선택된 전문가들을 동시에 실행
    results = await asyncio.gather(*tasks)  # 병렬 실행 후 결과 수집

    # 결과를 expert_docs에 매핑
    expert_docs = {}
    for i, expert_name in enumerate(valid_experts_to_run):
        expert_docs[expert_name] = results[i].get("documents", [])  # 전문가별 문서 리스트 저장

    return {"expert_docs": expert_docs}  # 다음 노드용 컨텍스트 반환

async def synthesize_final_answer_node(state: MetaAgentState) -> dict:
    """각 전문가가 검색한 '원본 문서'를 종합하여 최종 답변을 생성합니다."""  # 합성·후처리 노드

    logger.info("\n--- Synthesizer 실행: 답변 종합 ---")  # 합성 시작 로그
    messages = state['messages']  # 대화 히스토리
    expert_docs = state['expert_docs']  # 전문가별 문서

    context = ""  # 합성용 원문 컨텍스트
    for name, docs in expert_docs.items():
        if docs:
            context += f"### {name}가 찾은 관련 정보\n"  # 섹션 헤더
            for doc in docs:
                context += f"- {doc.page_content}\n"  # 원문 내용 나열
            context += "\n"

    if not context:
        final_answer = "죄송하지만, 문의하신 내용과 관련된 정보를 데이터베이스에서 찾지 못했습니다."  # 자료 없음 대응
    else:
        # 합성 프롬프트: 한글만, 마크다운 금지, 품종 일반화, 원문 밖 지어내기 금지 등 엄격 규칙
        synth_prompt = f"""당신은 여러 전문가가 찾아온 '원본 참고 자료'를 모두 검토하여, 사용자의 질문에 대한 하나의 완벽하고 일관된 답변을 작성하는 '수석 AI 커뮤니케이터'입니다.

[이전 대화 기록]
{"\n".join([f"{'사용자' if isinstance(msg, HumanMessage) else '챗봇'}: {msg.content}" for msg in messages[:-1]])}

[사용자의 최신 질문]
{messages[-1].content}

[각 전문가가 찾은 원본 참고 자료]
{context}

[사고 과정 (반드시 준수)]
1.  **질문 의도 파악**: 사용자의 질문 의도를 정확히 파악합니다. (예: 작물 추천, 재배법, 레시피, 영양 성분 등)
2.  **핵심 정보 식별**: 각 전문가가 가져온 자료에서 질문 의도에 맞는 핵심 정보를 식별합니다. (예: '작물 전문가' 자료에서 추천 작물 '상추' 식별)
3.  **정보 연결 및 선별**: '작물 전문가'가 '상추'를 추천했다면, '레시피 전문가'나 '영양 전문가'가 가져온 자료에서도 '상추'와 관련된 정보를 우선적으로 검색하고 연결합니다.
4.  **답변 구성**: 식별하고 연결한 정보들을 바탕으로 하나의 자연스러운 답변을 구성합니다.
5.  **일관성 검증**: 답변이 사용자의 모든 질문(예: 추천, 재배법, 레시피)에 빠짐없이 답했는지, 정보가 서로 충돌하지 않는지 확인합니다.

[절대 규칙]
- **언어 순수성 (매우 중요)**: 최종 답변은 **오직 순수 한글**로만 작성되어야 합니다.
- **품종 이름 일반화**: '설향' 같은 품종 이름은 대표 작물 이름인 '딸기' 등으로 바꿔서 설명해야 합니다.
- **형식 엄수**: 마크다운 서식(##, *, 1. 등)은 절대 사용하지 마세요.
- **근거 기반**: [원본 참고 자료]에 없는 내용은 절대 지어내지 마세요.

[실제 작업]
[최종 답변]"""
        chat_completion = await async_groq_client.chat.completions.create(
            messages=[{"role": "user", "content": synth_prompt}],  # 합성 프롬프트 전달
            model="llama-3.3-70b-versatile",  # 고성능 모델로 자연스러운 종합 답변 생성
            temperature=LLM_TEMPERATURE  # 약간의 다양성 허용
        )
        final_answer = chat_completion.choices[0].message.content  # 최종 답변 텍스트

    final_messages = messages + [AIMessage(content=final_answer)]  # 대화에 AI 답변 추가
    return {**state, "messages": final_messages}  # 상태 갱신 후 반환

# --- 4. 메인 워크플로우 구축 및 실행 ---
if __name__ == "__main__":
    farmer_agent = BaseExpertAgent(
        name="작물 전문가",
        collection_name="farmer",
        persona_prompt="작물 추천, 재배 환경, 성장 조건 등 농업 기술에 대한 모든 것을 다룹니다."
    )  # 작물 도메인 에이전트 생성

    recipe_agent = BaseExpertAgent(
        name="레시피 전문가",
        collection_name="receipe",
        persona_prompt="다양한 식재료를 활용한 요리 방법, 레시피, 조리 팁을 다룹니다."
    )  # 레시피 도메인 에이전트 생성(컬렉션명 주의)

    # ====[수정된 부분 4: nutrient_agent 인스턴스 생성]====
    # 새로운 '영양 전문가' 에이전트를 생성합니다. (컬렉션 이름 'nutrient'로 가정)
    nutrient_agent = BaseExpertAgent(
        name="영양 전문가",
        collection_name="nutrient", # 'nutrient' 컬렉션이 Milvus에 존재해야 합니다.
        persona_prompt="식품의 영양 성분, 칼로리, GI 지수, 건강 효능을 다룹니다."
    )  # 영양 도메인 에이전트 생성

    # ====[수정된 부분 5: expert_agents 딕셔너리 업데이트]====
    # 라우터가 인식할 수 있도록 '영양 전문가'를 딕셔너리에 추가합니다.
    expert_agents = { 
        "작물 전문가": farmer_agent, 
        "레시피 전문가": recipe_agent,
        "영양 전문가": nutrient_agent 
    }  # 이름→에이전트 매핑(라우터 참조용)

    # ====[수정된 부분 6: 워크플로우 구조 변경]====
    # '조건부 엣지'를 제거하고, 'router' -> 'run_experts' -> 'synthesizer'로 이어지는
    # 더 단순하고 확장 가능한 동적 워크플로우로 변경합니다.
    main_workflow = StateGraph(MetaAgentState)  # 메타 상태를 사용하는 메인 그래프

    main_workflow.add_node("router", llm_router_node)  # 전문가 선택 라우터 노드
    main_workflow.add_node("run_experts", run_selected_experts_node)  # 병렬 실행 노드
    main_workflow.add_node("synthesizer", synthesize_final_answer_node)  # 답변 합성 노드

    main_workflow.set_entry_point("router")  # 진입점: 라우터

    # 'router'가 전문가 목록을 결정하면, 'run_experts'가 이 목록을 받아 실행합니다.
    main_workflow.add_edge("router", "run_experts")  # 라우터→실행
    # 'run_experts'가 끝나면, 'synthesizer'가 모든 결과를 종합합니다.
    main_workflow.add_edge("run_experts", "synthesizer")  # 실행→합성
    main_workflow.add_edge("synthesizer", END)  # 합성 후 종료

    app = main_workflow.compile()  # 그래프 컴파일하여 실행기 생성

    # 그래프 시각화
    try:
        graph_image_path = "main_workflow.png"  # 다이어그램 파일 경로
        with open(graph_image_path, "wb") as f:
            f.write(app.get_graph().draw_mermaid_png())  # mermaid 기반 PNG 생성·저장
        logger.info(f"메인 워크플로우 구조가 '{graph_image_path}' 파일로 저장되었습니다.")  # 성공 로그
    except Exception as e:
        logger.warning(f"그래프 시각화 중 외부 API 접속에 실패했습니다 (챗봇 기능에 영향 없음).")  # 실패해도 기능 영향 없음 안내

    # 챗봇 실행
    print("\n" + "="*70)  # 배너 상단 구분선
    print(" AI 농업 & 요리 & 영양 전문가 (메타 워크플로우 모드) ".center(70, "="))  # 제목 라인
    print("="*70)  # 배너 하단 구분선
    print("안녕하세요! 작물, 레시피, 영양 성분 등 무엇이든 물어보세요.")  # 안내 문구
    print("-" * 70)  # 구분선

    # ====[수정된 부분 7: 초기 상태 변경]====
    # 새로운 상태 키('experts_to_run')를 반영하여 초기 상태를 수정합니다.
    current_state = {"messages": [], "expert_docs": {}, "experts_to_run": []}  # 메타 상태 초기화

    async def chat_loop():
        global current_state  # 외부 상태 참조
        while True:  # 지속 대화 루프
            user_input = await asyncio.to_thread(input, "나: ")  # 블로킹 input을 스레드로 감싸 비동기화
            if user_input.lower() == '종료':  # 종료 명령 처리
                print("챗봇: 대화를 종료합니다.")  # 종료 안내
                break  # 루프 탈출

            current_state["messages"].append(HumanMessage(content=user_input))  # 사용자 메시지 누적

            try:
                final_state = await app.ainvoke(current_state)  # 메인 그래프 비동기 실행(라우팅→검색→합성)
                # 다음 invoke를 위해 전체 상태를 업데이트합니다.
                current_state = {
                    "messages": final_state["messages"],  # 대화 히스토리 유지
                    "expert_docs": {}, # 다음 질문을 위해 문서는 비워줍니다.
                    "experts_to_run": []
                }  # 검색 컨텍스트 리셋으로 누적 오염 방지

                final_bot_message = final_state["messages"][-1]  # 최신 AI 메시지 추출

                print(f"챗봇: ", end="", flush=True)  # 프롬프트 출력
                for char in final_bot_message.content:
                    print(char, end="", flush=True)
                    await asyncio.sleep(0.02)  # 20ms 간격 타자 효과
                print("\n" + "-"*70)  # 출력 후 구분선

            except Exception as e:
                logger.error(f"메인 루프에서 오류 발생: {e}", exc_info=True)  # 예외 상세 로깅
                current_state["messages"].pop()  # 방금 입력 롤백으로 일관성 유지

    asyncio.run(chat_loop())  # 이벤트 루프에서 대화 실행

