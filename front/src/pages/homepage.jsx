import { useNavigate } from "react-router-dom";

// ---------------------------------------------------------
// 홈 페이지
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

          {/* 버튼 영역 */}
          <div className="button-group" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px', width: '100%' }}>
            
            {/* 기존: 채팅 시작 버튼 */}
            <button
              className="start-chat-btn"
              onClick={() => navigate("/chat", { state: { newChat: true } })}
            >
              채팅 시작 하기
            </button>

            {/* 추가됨: 음성 시작 버튼 */}
            <button
              className="start-voice-btn"
              // voiceMode: true를 전달하여 채팅 페이지 진입 시 음성 모드로 시작하게 함
              onClick={() => navigate("/chat", { state: { newChat: true, voiceMode: true } })}
            >
              음성 시작 하기
            </button>

          </div>
        </div>
      </main>
    </div>
  );
}

export default HomePage;