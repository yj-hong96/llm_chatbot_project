// src/pages/HomePage.jsx
import React, { useCallback } from "react";
import { useNavigate } from "react-router-dom";

// 여기 키들은 localStorage에 저장되는 키 (지우지 말고 그냥 두면 됨)
const CHAT_STORAGE_KEY = "chatConversations_v2";
const VOICE_STORAGE_KEY = "voiceConversations_v1";

// ---------------------------------------------------------
// 홈 페이지
// ---------------------------------------------------------
function HomePage() {
  const navigate = useNavigate();

  // ✅ 텍스트 채팅: 기존 기록은 그대로 두고, 새 대화만 하나 더 추가
  const handleStartChat = useCallback(() => {
    // ❌ 기록 삭제 X
    // ✅ ChatPage가 location.state.newChat 보고 새 대화만 추가
    navigate("/chat", { state: { newChat: true } });
  }, [navigate]);

  // ✅ 음성 채팅: 기존 음성 기록 유지 + 새 음성 대화 추가
  const handleStartVoice = useCallback(() => {
    // ❌ VOICE 기록 삭제 X
    navigate("/voice", { s// d:/vsc/front/src/pages/VoiceChatPage.jsx (가상 경로)
    
    import React, { useState, useEffect, useRef } from "react";
    import { useLocation, useNavigate } from "react-router-dom";
    import VoiceChatMessages from "../components/chat/VoiceChatMessages";
    // ... 다른 import들
    
    function VoiceChatPage() {
      const [messages, setMessages] = useState([]);
      const [isSpeaking, setIsSpeaking] = useState(false);
      const [speakingMessageIndex, setSpeakingMessageIndex] = useState(null);
      const [speakingCharIndex, setSpeakingCharIndex] = useState(-1);
      
      const location = useLocation();
      const navigate = useNavigate();
    
      // ... (기존 상태 및 함수들)
    
      // ✅ TTS 재생 함수 (이미 구현되어 있을 것으로 예상)
      const speak = (text, messageIndex) => {
        // ... (window.speechSynthesis를 사용하여 TTS를 재생하는 로직)
        // onstart, onboundary, onend 이벤트 핸들러 포함
      };
    
      // ✅ 새 음성 채팅 자동 재생을 위한 useEffect
      useEffect(() => {
        // location.state에서 startWithVoice 값을 확인합니다.
        const shouldStartWithVoice = location.state?.startWithVoice;
    
        // 자동 재생 조건: startWithVoice가 true이고, 첫 번째 봇 메시지가 있으며, 아직 재생 중이 아닐 때
        if (shouldStartWithVoice && messages.length > 0 && !isSpeaking) {
          const firstBotMessage = messages.find(m => m.role === 'bot');
          const firstBotMessageIndex = messages.findIndex(m => m.role === 'bot');
    
          if (firstBotMessage) {
            // 첫 봇 메시지를 TTS로 읽어줍니다.
            speak(firstBotMessage.text, firstBotMessageIndex);
    
            // 한 번 실행된 후에는 state를 초기화하여, 페이지에 머무는 동안 새로고침 없이
            // 메시지가 추가되어도 다시 실행되지 않도록 합니다.
            // navigate(location.pathname, { replace: true, state: {} });
            // 또는 아래와 같이 state를 직접 수정할 수 있습니다. (React Router v6+)
            window.history.replaceState({}, document.title)
          }
        }
      }, [messages, location.state, isSpeaking, navigate]); // 의존성 배열에 필요한 값 추가
    
    
      // ... (나머지 컴포넌트 로직)
    
      return (
        <div>
          {/* ... */}
          <VoiceChatMessages
            messages={messages}
            // ... 다른 props
            speakingMessageIndex={speakingMessageIndex}
            speakingCharIndex={speakingCharIndex}
            onStopGlobalSpeak={handleStopSpeak} // 중지 함수 전달
          />
          {/* ... */}
        </div>
      );
    }
    
    export default VoiceChatPage;
    // d:/vsc/front/src/pages/HomePage.jsx (가상 경로)
    
    import React from "react";
    import { useNavigate } from "react-router-dom";
    
    function HomePage() {
      const navigate = useNavigate();
    
      const handleStartVoiceChat = () => {
        // 새 음성 채팅 ID 생성 또는 가져오기
        const newChatId = `voice-${Date.now()}`; 
        
        // VoiceChatPage로 이동하면서 startWithVoice 상태를 전달
        navigate(`/voice-chat/`, { state: { startWithVoice: true } });
      };
    
      return (
        <div>
          {/* ... */}
          <button onClick={handleStartVoiceChat}>
            음성 채팅 시작하기
          </button>
          {/* ... */}
        </div>
      );
    }
    
    export default HomePage;
    tate: { newChat: true, autoPlay: true } });
  }, [navigate]);

  return (
    <div className="page home-page">
      <header className="app-header">
        <div
          className="logo-box"
          onClick={() => window.location.reload()}
          style={{ cursor: "pointer" }}
        >
          <h1 className="logo-text">챗봇</h1>
        </div>
      </header>

      <main className="home-main">
        <div className="home-main-inner">
          <div className="hero-image">
            <img className="hero-bg" src="/img/homepage.jpg" alt="홈 배경" />
          </div>

          {/* 버튼 영역 */}
          <div
            className="button-group"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "15px",
              width: "100%",
            }}
          >
            {/* 1. 텍스트 채팅 시작 - 기록 유지 + 새 대화 추가 */}
            <button className="start-chat-btn" onClick={handleStartChat}>
              채팅 시작 하기
            </button>

            {/* 2. 음성 채팅 시작 - 기록 유지 + 새 음성 대화 추가 */}
            <button className="start-voice-btn" onClick={handleStartVoice}>
              음성 시작 하기
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default HomePage;
