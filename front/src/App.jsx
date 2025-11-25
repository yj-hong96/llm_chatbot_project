// App.jsx
// =========================================================
// 메인 라우팅 설정
// /chat 경로를 기존 ChatPage에서 새로 만든 VoiceChatPage로 변경했습니다.
// =========================================================

import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./App.css";

// 페이지 컴포넌트 임포트
import HomePage from "./pages/homepage";
import VoiceChatPage from "./pages/VoiceChatPage"; // 변경됨: ChatPage -> VoiceChatPage

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 홈 페이지 */}
        <Route path="/" element={<HomePage />} />
        
        {/* 채팅 페이지 (음성/텍스트 통합) */}
        <Route path="/chat" element={<VoiceChatPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;