# D:\vsc\run_test_server.py
from flask import (
    Flask,
    request,
    jsonify,
    Response,
    stream_with_context,
)
from flask_cors import CORS
import asyncio
import time
import json

import test  # 같은 폴더의 test.py (async def ask_experts(...) 있어야 함)

app = Flask(__name__)
CORS(app)  # React 개발 서버(예: http://localhost:5173)에서 오는 요청 허용


# ---------------------------------------------------------
# 기본: 한 번에 요청/응답 하는 /chat
# ---------------------------------------------------------
@app.post("/chat")
def chat():
    """
    React에서 POST /chat 으로 { "message": "..." } 보내면
    test.ask_experts 를 호출해서 답변을 돌려주는 엔드포인트
    """
    data = request.get_json(force=True)
    user_input = data.get("message", "").strip()

    if not user_input:
        return jsonify({"error": "message 필드가 비어 있습니다."}), 400

    try:
        # ask_experts 는 async 함수라 asyncio.run 으로 감싸서 실행
        answer = asyncio.run(test.ask_experts(user_input))
        return jsonify({"answer": answer})

    except Exception as e:
        # 프론트에서는 data.error 로 받게 됨
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------
# SSE: 단계별 상태(understanding/searching/composing) + 최종 answer 푸시
# ---------------------------------------------------------
@app.get("/chat-stream")
def chat_stream():
    """
    React에서 GET /chat-stream?message=... 로 접속하면
    SSE(EventSource)로 단계(phase)와 최종 answer 를 순서대로 푸시하는 엔드포인트
    """
    user_input = request.args.get("message", "").strip()
    if not user_input:
        return jsonify({"error": "message 쿼리스트링이 비어 있습니다."}), 400

    @stream_with_context
    def generate():
        # 1) 질문 이해 단계
        yield "event: phase\ndata: understanding\n\n"
        time.sleep(0.7)  # 시각 효과용 딜레이(원하면 줄이거나 삭제 가능)

        # 2) 자료 검색 단계
        yield "event: phase\ndata: searching\n\n"
        time.sleep(0.7)

        # 3) 답안 구성 단계 시작
        yield "event: phase\ndata: composing\n\n"

        # 4) 실제 에이전트 호출 (기존 test.ask_experts)
        try:
            answer = asyncio.run(test.ask_experts(user_input))
        except Exception as e:
            # 에러 이벤트 전송
            err_payload = json.dumps({"error": str(e)}, ensure_ascii=False)
            yield f"event: error\ndata: {err_payload}\n\n"
            return

        # 5) 최종 답변 이벤트 전송
        payload = json.dumps({"answer": answer}, ensure_ascii=False)
        yield f"event: answer\ndata: {payload}\n\n"

    # SSE 응답 형식
    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # nginx 같은 reverse proxy 쓸 때 버퍼링 방지용 (지금은 없어도 크게 상관 없음)
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    # http://127.0.0.1:5000
    app.run(host="127.0.0.1", port=5000, debug=True)
