import { useNavigate } from "react-router-dom";

// ---------------------------------------------------------
// 홈 페이지(변경 금지)
// ---------------------------------------------------------
function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="page home-page">
      <header className="app-header">
        <div className="logo-box" onClick={() => window.location.reload()}>
          <h1 className="logo-text">챗봇</h1>
        </div>
      </header>

      <main className="home-main">
        <div className="home-main-inner">
          <div className="hero-image">
            <img className="hero-bg" src="/img/homepage.jpg" alt="홈 배경" />
          </div>

          <button
            className="start-chat-btn"
            onClick={() => navigate("/chat", { state: { newChat: true } })}
          >
            채팅 시작 하기
          </button>
        </div>
      </main>
    </div>
  );
}

export default HomePage;
