// 메인/채팅 라우팅 및 로고 클릭 동작을 담당하는 JSX
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import "./App.css";

function HomePage() {
  const navigate = useNavigate(); // 있어도 되고, 안 써도 됨

  return (
    <div className="page home-page">
      <header className="app-header">
        {/* 첫 화면에서 로고 클릭 -> 실제 새로고침 */}
        <div
          className="logo-box"
          onClick={() => window.location.reload()}
        >
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

  return (
    <div className="page chat-page">
      <header className="app-header chat-header">
        {/* 채팅 화면에서 로고 클릭 -> 첫 화면으로 이동 */}
        <div
          className="logo-box"
          onClick={() => navigate("/")}
        >
          <h1 className="logo-text small">챗봇</h1>
        </div>
      </header>

      <main className="chat-main">
        <div className="chat-container">
          <div className="chat-messages">
            <div className="message bot">안녕하세요! 무엇을 도와드릴까요?</div>
            <div className="message user">테스트 메시지 입니다.</div>
          </div>

          <div className="chat-input-area">
            <input
              className="chat-input"
              type="text"
              placeholder="메시지를 입력하세요..."
            />
            <button className="chat-send-btn">
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
