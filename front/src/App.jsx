// 메인/채팅 라우팅과 대화 상태·저장, 레이아웃을 담당하는 JSX
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import "./App.css";

const STORAGE_KEY = "chatMessages_v1"; // 브라우저에 저장할 키 이름

function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="page home-page">
      <header className="app-header">
        {/* 첫 화면에서 로고 클릭 -> 실제 새로고침 */}
        <div className="logo-box" onClick={() => window.location.reload()}>
          <h1 className="logo-text">챗봇</h1>
        </div>
      </header>

      <main className="home-main">
        <div className="hero-image">
          <img className="hero-bg" src="/img/homepage.jpg" alt="홈 배경" />
        </div>

        <button
          className="start-chat-btn"
          onClick={() => navigate("/chat")}
        >
          채팅 시작 하기
        </button>
      </main>
    </div>
  );
}

function ChatPage() {
  const navigate = useNavigate();

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // 1) 처음 렌더링할 때 localStorage에서 이전 대화를 불러옴
  const [messages, setMessages] = useState(() => {
    try {
      if (typeof window === "undefined") {
        return [{ role: "bot", text: "안녕하세요! 무엇을 도와드릴까요?" }];
      }

      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.error("저장된 채팅 기록을 불러오는 중 오류:", e);
    }

    // 저장된 기록이 없으면 기본 인사 메시지로 시작
    return [{ role: "bot", text: "안녕하세요! 무엇을 도와드릴까요?" }];
  });

  // 2) messages가 바뀔 때마다 localStorage에 저장
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch (e) {
      console.error("채팅 기록 저장 중 오류:", e);
    }
  }, [messages]);

  // 채팅창 끝으로 스크롤 (이전 기록은 위로 스크롤해서 확인)
  const messagesEndRef = useRef(null);
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }
  }, [messages, loading]);

  // test.py(백엔드 LangGraph)에게 질문 보내기
  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    // 화면에 내 메시지를 먼저 추가
    const newMessages = [...messages, { role: "user", text: trimmed }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      // Flask 서버로 내 질문 전송
      const res = await fetch("http://127.0.0.1:5000/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: trimmed }),
      });

      const data = await res.json();
      console.log("test.py 응답:", data);

      if (data.error) {
        setMessages((prev) => [
          ...prev,
          { role: "bot", text: `오류가 발생했습니다: ${data.error}` },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "bot", text: data.answer || "(응답이 없습니다)" },
        ]);
      }
    } catch (err) {
      console.error("요청 실패:", err);
      setMessages((prev) => [
        ...prev,
        { role: "bot", text: "서버에 연결할 수 없습니다. (Flask 서버 확인)" },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="page chat-page">
      {/* 좌측 5% / 우측 고정 여백을 제외한 전체 영역 */}
      <div className="chat-shell">
        <header className="app-header chat-header">
          {/* 채팅 화면에서 로고 클릭 -> 첫 화면으로 이동 */}
          <div className="logo-box" onClick={() => navigate("/")}>
            <h1 className="logo-text small">챗봇</h1>
          </div>
        </header>

        <main className="chat-main">
          <div className="chat-container">
            <div className="chat-messages">
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`message ${m.role === "bot" ? "bot" : "user"}`}
                >
                  {m.text}
                </div>
              ))}

              {/* 로딩 중일 때, 실시간으로 깜빡이는 '답변 준비 중' 표시 */}
              {loading && (
                <div className="message bot loading-message">
                  <span>챗봇이 답변을 준비하고 있어요</span>
                  <span className="typing-dots">
                    <span className="dot" />
                    <span className="dot" />
                    <span className="dot" />
                  </span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <div className="chat-input-area">
              <input
                className="chat-input"
                type="text"
                placeholder={
                  loading
                    ? "응답을 기다리는 중입니다..."
                    : "메시지를 입력하세요..."
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
              />
              <button
                className="chat-send-btn"
                onClick={sendMessage}
                disabled={loading}
              >
                <img
                  src="/img/trans_message.png"
                  alt="전송"
                  className="send-icon"
                />
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/chat" element={<ChatPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
