# llm_chatbot_project

10.14 // 하이브리드 검색, 스트리밍 응답, 로깅 시스템 도입.


10.22 // db_load CPU 사용 시, CSV 파일 임베딩 하는데 시간 오래걸렸음 -> GPU 사용 시 10분 내외 Milvus_db에 저장 완료.
결론 : CPU < GPU 성능 좋음.

10.28 // nutrient_agent main.py 결합. <- 아직 안정도 0% <- 의도 질문 확인 x

11.03 // nutrient_ agent main.py 재 결합 <- 안정도 5%? 정도. 각 질문 분배 확인, 병렬 처리 확인. 안정도 x>

11.5 // VITE install 설치 완료 <- front_end 초안 figma작성.>
 ㄱ. homepage, chatpage 틀 완료 // 챗 봇 누를 시 홈페이지로 돌아가짐. or 챗 봇 누를 시 새로고침. 완료
 ㄴ. 아이콘 배너 정리 완료
 ㄷ. 아직 채팅.py,채팅 연동 x 


 ------------------------------------------------------------------------
 
해결 방법 1: 현재 터미널에서만 임시로 허용 (가장 안전)
현재 사용 중인 PowerShell 터미널 창에만 일회성으로 스크립트 실행을 허용하는 방법입니다. 터미널을 껐다 켜면 원래대로 돌아갑니다.

현재 오류가 발생한 터미널에 다음 명령어를 입력하고 Enter를 누르세요.

PowerShell

Set-ExecutionPolicy Bypass -Scope Process
아무런 확인 메시지 없이 다음 줄로 넘어가면 성공입니다.

이제 다시 npm run dev를 실행해 보세요.

해결 방법 2: 터미널 종류 변경 (VS Code 추천)
오류가 발생한 터미널이 PowerShell이기 때문에 생기는 문제입니다. VS Code를 사용 중이라면 터미널을 **Command Prompt (cmd)**로 변경하면 즉시 해결됩니다.

VS Code 터미널 창의 오른쪽 상단을 보세요. (아마 powershell이라고 보일 겁니다)

+ 버튼 옆의 아래쪽 화살표(v) 아이콘을 클릭합니다.

Command Prompt를 선택합니다.

새로 열린 cmd 터미널에서 npm run dev를 실행합니다.

해결 방법 3: 실행 정책 영구 변경 (개발자용 설정)
앞으로 계속 PowerShell에서 npm 스크립트를 사용하려면, 컴퓨터의 실행 정책을 변경해야 합니다. 이 작업은 관리자 권한이 필요합니다.

시작 메뉴를 열고 'PowerShell'을 검색합니다.

Windows PowerShell 아이콘에 마우스를 올리고 **[관리자 권한으로 실행]**을 클릭합니다.

관리자 권한으로 열린 파란색 PowerShell 창에 다음 명령어를 입력합니다.

PowerShell

Set-ExecutionPolicy RemoteSigned
실행 정책을 변경하시겠습니까?라고 물어보면 Y (Yes) 또는 A (모두 예)를 입력하고 Enter를 누릅니다.

관리자 PowerShell 창을 끕니다.

VS Code를 포함한 모든 터미널을 껐다가 다시 켠 후, npm run dev를 실행해 보세요.

요약:

지금 당장 한 번만 실행하려면: 1번 방법을 사용하세요.

VS Code 사용자라면: 2번 방법이 가장 간편합니다.

내 컴퓨터에서 항상 되게 하려면: 3번 방법을 사용하세요.
 

------------------------

pip install flask flask-cors