import os
import logging
import asyncio
from typing import TypedDict, List, Dict
from dotenv import load_dotenv

# Flask 관련 (동기 방식 사용)
from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename

# LangChain / LangGraph / Groq / Milvus
from groq import AsyncGroq
from langchain_core.messages import HumanMessage, AIMessage, BaseMessage
from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings
from pymilvus import connections, Collection
from langgraph.graph import StateGraph, END

# --- 1. 초기 설정 ---
app = Flask(__name__)
CORS(app)

# 파일 저장 경로
UPLOAD_FOLDER = 'uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# 로깅
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

load_dotenv()

# Milvus 등 설정
MILVUS_HOST = "localhost"
MILVUS_PORT = "19530"
EMBEDDING_MODEL = "jhgan/ko-sroberta-multitask"
LLM_TEMPERATURE = 0.3

# --- 클라이언트 초기화 ---
try:
    # Groq 클라이언트 (비동기)
    async_groq_client = AsyncGroq()
    # 임베딩 (동기)
    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    # Milvus 연결
    if not connections.has_connection("default"):
        connections.connect("default", host=MILVUS_HOST, port=MILVUS_PORT)
    logger.info("시스템 초기화 완료")
except Exception as e:
    logger.error(f"초기화 오류: {e}")


# --- 2. 전문가 에이전트 클래스 ---
class BaseExpertAgent:
    def __init__(self, name: str, collection_name: str, persona_prompt: str):
        self.name = name
        self.collection_name = collection_name
        self.persona_prompt = persona_prompt
        try:
            self.collection = Collection(self.collection_name)
            self.collection.load()
        except Exception as e:
            logger.warning(f"[{self.name}] 컬렉션 로드 실패 (생성되지 않았을 수 있음): {e}")
            self.collection = None

        self.workflow = self._build_workflow()

    def _build_workflow(self):
        workflow = StateGraph(dict)
        workflow.add_node("rewriter", self._rewrite_query)
        workflow.add_node("retriever", self._retrieve)
        workflow.set_entry_point("rewriter")
        workflow.add_edge("rewriter", "retriever")
        workflow.add_edge("retriever", END)
        return workflow.compile()

    async def _rewrite_query(self, state: dict) -> dict:
        messages = state['messages']
        last_message = messages[-1]
        # 쿼리 재작성 로직
        prompt = f"""역할: {self.name} ({self.persona_prompt})
질문: {last_message.content}
지침: 관련 있으면 검색용 질문 1줄 작성, 관련 없으면 "pass" 출력. 설명 금지."""
        
        try:
            response = await async_groq_client.chat.completions.create(
                messages=[{"role": "user", "content": prompt}],
                model="llama-3.1-8b-instant", temperature=0.0
            )
            rewritten = response.choices[0].message.content.strip()
        except:
            rewritten = "pass"
            
        return {**state, "rewritten_query": rewritten}

    async def _retrieve(self, state: dict) -> dict:
        query = state.get("rewritten_query", "pass")
        if query == "pass" or not self.collection:
            return {**state, "documents": []}
        
        try:
            vector = embeddings.embed_query(query)
            results = self.collection.search(
                data=[vector], anns_field="vector", 
                param={"metric_type": "L2", "params": {"nprobe": 10}}, 
                limit=3, output_fields=["text"]
            )
            docs = [Document(page_content=h.entity.get("text")) for h in results[0]] if results else []
            return {**state, "documents": docs}
        except:
            return {**state, "documents": []}

    async def run(self, messages: List[BaseMessage]):
        return await self.workflow.ainvoke({"messages": messages})


# --- 3. 전역 인스턴스 ---
expert_agents = {
    "작물 전문가": BaseExpertAgent("작물 전문가", "farmer", "작물 추천, 재배법"),
    "레시피 전문가": BaseExpertAgent("레시피 전문가", "receipe", "요리법, 레시피"),
    "영양 전문가": BaseExpertAgent("영양 전문가", "nutrient", "영양 성분, 효능")
}

# --- 4. LangGraph 노드 정의 ---
class MetaAgentState(TypedDict):
    messages: List[BaseMessage]
    expert_docs: Dict[str, List[Document]]
    experts_to_run: List[str]

async def llm_router_node(state: MetaAgentState) -> dict:
    # 라우터 로직
    question = state["messages"][-1].content
    prompt = f"""질문: {question}
전문가: {", ".join(expert_agents.keys())}
지침: 필요한 전문가 이름만 쉼표로 구분해 출력. 없으면 전체 출력."""
    
    try:
        res = await async_groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.1-8b-instant", temperature=0.0
        )
        selected = [n.strip() for n in res.choices[0].message.content.split(',') if n.strip() in expert_agents]
        if not selected: selected = list(expert_agents.keys())
        return {"experts_to_run": selected}
    except:
        return {"experts_to_run": list(expert_agents.keys())}

async def run_selected_experts_node(state: MetaAgentState) -> dict:
    targets = state["experts_to_run"]
    tasks = [expert_agents[name].run(state["messages"]) for name in targets]
    if not tasks: return {"expert_docs": {}}
    results = await asyncio.gather(*tasks)
    
    expert_docs = {}
    for name, res in zip(targets, results):
        if res.get("documents"):
            expert_docs[name] = res.get("documents")
    return {"expert_docs": expert_docs}

async def synthesize_final_answer_node(state: MetaAgentState) -> dict:
    docs_str = ""
    for name, docs in state["expert_docs"].items():
        docs_str += f"\n[{name}]\n" + "\n".join([f"- {d.page_content}" for d in docs])
    
    if not docs_str: docs_str = "관련 정보 없음."
    
    prompt = f"""질문: {state['messages'][-1].content}
자료: {docs_str}
지침: 자료를 바탕으로 한국어로 답변."""
    
    res = await async_groq_client.chat.completions.create(
        messages=[{"role": "user", "content": prompt}],
        model="llama-3.3-70b-versatile", temperature=0.3
    )
    return {**state, "messages": state["messages"] + [AIMessage(content=res.choices[0].message.content)]}

# 그래프 컴파일
workflow = StateGraph(MetaAgentState)
workflow.add_node("router", llm_router_node)
workflow.add_node("run_experts", run_selected_experts_node)
workflow.add_node("synthesizer", synthesize_final_answer_node)
workflow.set_entry_point("router")
workflow.add_edge("router", "run_experts")
workflow.add_edge("run_experts", "synthesizer")
workflow.add_edge("synthesizer", END)
langgraph_app = workflow.compile()


# --- 5. [핵심] Flask API 라우트 (동기 방식 + 방어 로직) ---

@app.route('/chat', methods=['POST'])
def chat():
    """
    프론트엔드에서 보낸 데이터(JSON 또는 FormData)를 안전하게 처리하는 핸들러
    """
    try:
        # 1. 요청 데이터 타입 확인 및 파싱 (방어 코드)
        user_message = ""
        file_info = ""

        # Case A: 순수 JSON 요청 (파일 없음)
        if request.is_json:
            data = request.get_json()
            user_message = data.get('message', '')
        
        # Case B: Multipart/FormData 요청 (파일 포함 가능)
        elif request.mimetype.startswith('multipart/form-data'):
            user_message = request.form.get('message', '')
            
            # 파일 처리
            if 'file' in request.files:
                file = request.files['file']
                if file and file.filename != '':
                    filename = secure_filename(file.filename)
                    save_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                    file.save(save_path)
                    file_info = f" [시스템: 사용자가 '{filename}' 파일을 업로드함]"
                    print(f" >> 파일 저장 완료: {save_path}")
        
        # Case C: 알 수 없는 타입
        else:
            # 강제로 form이나 data에서 긁어오기 시도
            user_message = request.values.get('message', '')

        # 메시지가 비어있으면 에러
        full_query = (user_message + file_info).strip()
        if not full_query:
            return jsonify({'error': '메시지 내용이 없습니다.'}), 400

        print(f" >> 사용자 질문 수신: {full_query}")

        # 2. LangGraph 실행 (비동기 함수를 동기 라우트에서 실행하기 위해 asyncio.run 사용)
        # 매 요청마다 새로운 이벤트 루프를 생성하여 실행
        initial_state = {
            "messages": [HumanMessage(content=full_query)],
            "expert_docs": {},
            "experts_to_run": []
        }
        
        # 비동기 그래프 실행을 동기적으로 대기
        final_state = asyncio.run(langgraph_app.ainvoke(initial_state))
        
        bot_response = final_state["messages"][-1].content
        
        return jsonify({'answer': bot_response})

    except Exception as e:
        logger.error(f"API 에러 발생: {e}", exc_info=True)
        # 에러 내용을 JSON으로 명확하게 반환
        return jsonify({'error': f"서버 내부 오류: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)