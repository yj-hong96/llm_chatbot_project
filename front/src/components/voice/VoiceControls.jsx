// src/components/voice/VoiceControls.jsx
import React from "react";

function VoiceControls({ 
  isListening, isSpeaking, isPaused, loading, input, hasSpeakableBotMessage,
  onPlayClick, onMicClick 
}) {
  return (
    <div className="voice-controls">
      <div className="voice-transcript">
        {isListening ? input || "듣고 있습니다..." : ""}
      </div>

      <div className="voice-button-row">
        {/* 재생/일시정지 버튼 */}
        <button
          className={"play-button " + (isSpeaking ? (isPaused ? "paused" : "playing") : "") + (!hasSpeakableBotMessage || loading ? " disabled" : "")}
          onClick={onPlayClick}
          disabled={!hasSpeakableBotMessage || loading}
        >
          {!hasSpeakableBotMessage ? "▶️" : isSpeaking ? (isPaused ? "▶️" : "⏸️") : "▶️"}
        </button>

        {/* 마이크 버튼 */}
        <button
          className={"mic-button " + (loading ? "loading" : isListening ? "listening" : "idle")}
          onClick={onMicClick}
          disabled={loading}
        >
          {loading ? "⏳" : isListening ? "⏹️" : "🎤"}
        </button>
      </div>

      <div className="voice-status">
        {loading ? "답변을 생성하고 있어요..." : isSpeaking ? "답변을 읽어주는 중입니다." : "마이크 버튼으로 음성 질문을 해보세요."}
      </div>
    </div>
  );
}

export default VoiceControls;