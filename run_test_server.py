# D:\vsc\run_test_server.py
from flask import Flask, request, jsonify
from flask_cors import CORS
import asyncio

import test  # 같은 폴더의 test.py (위에서 수정한 버전)가 import됨

app = Flask(__name__)
CORS(app)  # React 개발 서버(5173)에서 오는 요청 허용


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
        # ask_experts 는 async 함수라 asyncio.run 으로 한 번 돌려줌
        answer = asyncio.run(test.ask_experts(user_input))
        return jsonify({"answer": answer})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    # http://127.0.0.1:5000
    app.run(host="127.0.0.1", port=5000, debug=True)
