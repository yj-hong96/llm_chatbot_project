# 필요한 라이브러리들을 가져옵니다.
import os # 운영체제와 상호작용 (파일 경로 등)
import io # 메모리 내에서 텍스트/바이너리 데이터 처리
import csv # CSV 파일 처리
import pathlib # 파일 경로를 객체 지향적으로 다루기
import logging # 로그 기록 기능
from typing import TypedDict, List, Optional, Set # 타입 힌트 (코드 가독성 향상)
from tqdm import tqdm # 작업 진행률 표시줄

# LangChain / Embedding / Milvus 관련 라이브러리
from langchain_community.document_loaders import PyPDFLoader, TextLoader # PDF, 텍스트 파일 로더
from langchain.text_splitter import RecursiveCharacterTextSplitter # 텍스트를 작은 조각으로 나누는 도구
from langchain_huggingface import HuggingFaceEmbeddings # 허깅페이스 모델을 이용한 임베딩 생성
from langchain_core.documents import Document # LangChain의 표준 문서 객체

from pymilvus import connections, utility, FieldSchema, CollectionSchema, DataType, Collection # Milvus 데이터베이스 상호작용

# LangGraph (워크플로우 시각화용)
from langgraph.graph import StateGraph, END

# 판다스 (데이터 처리, 특히 CSV/Excel)
import pandas as pd

# [추가] GPU 사용 확인을 위한 torch
import torch

# === 선택적 의존성: chardet 라이브러리가 설치되어 있으면 인코딩 추정에 활용 ===
try:
    import chardet # chardet 라이브러리 가져오기 시도
    HAS_CHARDET = True # 성공 시 플래그 True
except ImportError:
    HAS_CHARDET = False # 실패 시 플래그 False

MILVUS_BATCH_SIZE = 5000 # <-- 추가: 한 번에 Milvus에 보낼 조각(Chunk) 개수

# ==============================================================================
# 0. 로깅 설정 (Logging Configuration)
# ==============================================================================
logging.basicConfig( # 로깅 기본 설정
    level=logging.INFO, # 로그 레벨을 INFO로 설정 (INFO, WARNING, ERROR, CRITICAL 메시지 표시)
    format='%(asctime)s - %(levelname)s - %(message)s', # 로그 메시지 형식 정의 (시간 - 레벨 - 메시지)
    handlers=[ # 로그를 처리할 핸들러 목록
        logging.FileHandler("ingest_data.log", encoding='utf-8'), # 'ingest_data.log' 파일에 UTF-8 인코딩으로 로그 기록
        logging.StreamHandler() # 콘솔(표준 출력)에도 로그 출력
    ]
)
logger = logging.getLogger(__name__) # 현재 모듈에 대한 로거 인스턴스 가져오기


# ==============================================================================
# 1. 설정 (Configuration)
# ==============================================================================
MILVUS_HOST = "localhost" # Milvus 서버 호스트 주소
MILVUS_PORT = "19530" # Milvus 서버 포트 번호

COLLECTION_NAME = "receipe"  # Milvus에 저장할 컬렉션 이름 (레시피 데이터용)
# COLLECTION_NAME = "crop_info"  # (다른 컬렉션 사용 시 주석 해제)

DIMENSION = 768 # 임베딩 벡터의 차원 수 (사용하는 모델에 따라 결정됨)
EMBEDDING_MODEL = "jhgan/ko-sroberta-multitask" # 사용할 허깅페이스 임베딩 모델 이름

DATA_PATH = r"D:\vsc\receipe" # 데이터 파일(PDF, CSV 등)이 있는 디렉토리 경로
# DATA_PATH = r"D:\vsc\crop_info" # (다른 경로 사용 시 주석 해제)

# [업데이트] DB에 이미 존재하더라도 강제로 다시 처리하고 싶은 파일명 목록
FORCE_REPROCESS = set([
    # "TB_RECIPE_SEARCH-20231130.csv", # 예: 이 파일의 주석을 해제하면 항상 다시 처리됨
    # "TB_RECIPE_SEARCH-220701.csv",
])

# [업데이트] 파일 스캔 시 지원 확장자가 아니더라도 일단 로딩을 시도할 확장자 목록
FORCE_INCLUDE_EXTS = {".csv", ".tsv"}  # .csv와 .tsv는 확장자가 달라도 일단 CSV/TSV 로더로 시도


# ==============================================================================
# 2. Milvus 연결 및 컬렉션 준비 (Connect to Milvus and Prepare Collection)
# ==============================================================================
def setup_milvus_collection():
    """Milvus에 연결하고, 정의된 스키마로 컬렉션을 준비합니다."""
    try:
        logger.info(f"Milvus에 연결을 시도합니다... (주소: {MILVUS_HOST}:{MILVUS_PORT})") # 연결 시도 로그
        connections.connect("default", host=MILVUS_HOST, port=MILVUS_PORT) # 연결 수행
        logger.info("Milvus에 성공적으로 연결되었습니다.") # 성공 로그
    except Exception as e:
        logger.error(f"Milvus 연결에 실패했습니다: {e}") # 실패 로그
        raise # 오류 발생 시 스크립트 중단

    # Milvus 컬렉션의 스키마 필드 정의
    fields = [
        FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=True), # 기본 키, 자동 생성 ID
        FieldSchema(name="source", dtype=DataType.VARCHAR, max_length=1024), # 원본 파일명 또는 URL
        FieldSchema(name="page", dtype=DataType.INT32),  # PDF 페이지 번호 또는 CSV/Excel 행 번호
        FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=65535), # 실제 텍스트 조각
        FieldSchema(name="vector", dtype=DataType.FLOAT_VECTOR, dim=DIMENSION), # 임베딩 벡터
    ]
    # 컬렉션 스키마 객체 생성
    schema = CollectionSchema(fields, description="Document Collection with metadata")

    # 컬렉션이 이미 존재하는지 확인
    if utility.has_collection(COLLECTION_NAME):
        existing_collection = Collection(name=COLLECTION_NAME) # 기존 컬렉션 객체 가져오기
        # 기존 컬렉션의 스키마와 새로 정의한 스키마가 다른지 필드 이름으로 비교
        if set(f.name for f in existing_collection.schema.fields) != set(f.name for f in schema.fields):
            logger.warning("기존 컬렉션의 스키마가 변경되어 삭제 후 재생성합니다.") # 스키마 불일치 및 삭제 로그
            utility.drop_collection(COLLECTION_NAME) # 기존 컬렉션 삭제
            collection = Collection(name=COLLECTION_NAME, schema=schema) # 새 스키마로 컬렉션 생성
            logger.info("컬렉션이 성공적으로 생성되었습니다.") # 생성 성공 로그
            create_index(collection) # 새 컬렉션에 대한 벡터 인덱스 생성
        else:
            # 스키마가 동일하면 기존 컬렉션 사용
            logger.info(f"기존 컬렉션 '{COLLECTION_NAME}'을(를) 사용합니다.") # 기존 컬렉션 사용 로그
            collection = existing_collection # 기존 컬렉션 객체 사용
    else:
        # 컬렉션이 존재하지 않으면 새로 생성
        logger.info(f"컬렉션 '{COLLECTION_NAME}'이(가) 없어 새로 생성합니다.") # 신규 생성 로그
        collection = Collection(name=COLLECTION_NAME, schema=schema) # 컬렉션 생성
        logger.info("컬렉션이 성공적으로 생성되었습니다.") # 생성 성공 로그
        create_index(collection) # 벡터 인덱스 생성

    collection.load() # 검색을 위해 컬렉션을 메모리에 로드
    logger.info("컬렉션을 메모리에 로드했습니다. 검색이 준비되었습니다.") # 로드 성공 로그
    return collection # 준비된 컬렉션 객체 반환


def create_index(collection: Collection):
    """새 컬렉션에 대한 벡터 인덱스를 생성합니다."""
    logger.info("새 컬렉션에 대한 벡터 인덱스를 생성합니다...") # 인덱스 생성 시작 로그
    # 벡터 인덱스 파라미터 정의 (IVF_FLAT은 일반적인 선택)
    index_params = {
        "metric_type": "L2", # 거리 계산 방식 (유클리드 거리)
        "index_type": "IVF_FLAT", # 인덱스 유형
        "params": {"nlist": 128}, # IVF_FLAT의 클러스터 개수
    }
    # 'vector' 필드에 인덱스 생성
    collection.create_index(field_name="vector", index_params=index_params)
    logger.info("벡터 필드에 인덱스를 생성했습니다.") # 인덱스 생성 완료 로그


# ==============================================================================
# 3. 파일 로더 유틸 (File Loader Utilities - GPT의 강력한 로더)
# ==============================================================================

# 지원하는 파일 확장자 집합
SUPPORTED_EXTS = {
    ".pdf", ".txt", ".csv", ".tsv",
    ".xls", ".xlsx", ".xlsm",
}


def _read_head(path: str, n: int = 4096) -> bytes:
    """파일의 시작 부분 n 바이트를 바이너리로 읽습니다."""
    try:
        with open(path, "rb") as fb: # 파일을 바이너리 읽기 모드로 열기
            return fb.read(n) # 지정된 바이트 수만큼 읽기
    except Exception as e:
        logger.warning(f"파일 헤더 읽기 실패({path}): {e}") # 읽기 실패 시 경고 로그
        return b"" # 실패 시 빈 바이트 반환


def _looks_like_excel_bytes(head: bytes) -> Optional[str]:
    """
    파일 시작 바이트가 알려진 Excel 파일 시그니처와 일치하는지 확인합니다.
    xlsx/xlsm: ZIP 형식 (PK...)
    xls: OLE 형식 (D0 CF ...)
    """
    if head.startswith(b"PK\x03\x04"): # .xlsx/.xlsm (ZIP) 시그니처
        return "xlsx"
    if head.startswith(b"\xD0\xCF\x11\xE0"): # .xls (OLE) 시그니처
        return "xls"
    return None # Excel 시그니처가 아님


def _detect_encoding(head: bytes) -> List[str]:
    """
    인코딩 후보 리스트를 생성합니다. BOM(Byte Order Mark)을 먼저 확인하고,
    chardet이 설치된 경우 추측 결과를 우선 순위에 추가합니다.
    """
    # BOM을 먼저 확인하여 정확도 높임
    if head.startswith(b'\xef\xbb\xbf'): # UTF-8 BOM
        return ['utf-8-sig', 'utf-8']
    if head.startswith(b'\xff\xfe') or head.startswith(b'\xfe\xff'): # UTF-16 BOM (리틀/빅 엔디안)
         return ['utf-16', 'utf-16le', 'utf-16be']

    # 일반적인 인코딩 후보 목록
    cands = ["utf-8", "cp949", "euc-kr", "cp1252", "latin1"]
    # chardet이 있으면 추측 결과 사용
    if HAS_CHARDET:
        try:
            guessed = (chardet.detect(head) or {}).get("encoding") # chardet으로 인코딩 추측
            # 추측 결과가 새롭고 유효하면 후보 목록 맨 앞에 추가
            if guessed and guessed.lower() not in [c.lower() for c in cands]:
                cands.insert(0, guessed)
        except Exception:
            pass # chardet 오류는 무시
    # 후보 목록에서 None이나 중복 제거하여 최종 목록 생성
    uniq: List[str] = []
    for e in cands:
        if e and e not in uniq:
            uniq.append(e)
    return uniq


def read_csv_robust(file_path: str) -> pd.DataFrame:
    """
    강건한(Robust) CSV/TSV 로더:
    - 인코딩 자동 추정 (BOM, chardet, 후보 목록)
    - 구분자 자동 추정 (None, ',', '\t', ';', '|')
    - 파일 확장자가 .csv라도 실제로는 Excel 파일일 경우 처리
    - 손상된 문자 무시 (encoding_errors='ignore')
    """
    logger.info(f"CSV 로더 시작: {os.path.basename(file_path)}") # CSV 로딩 시작 로그
    head = _read_head(file_path) # 파일 헤더 읽기

    # .csv 파일이 실제로는 Excel 파일인지 시그니처로 확인
    kind = _looks_like_excel_bytes(head)
    if kind:
        logger.info("CSV 확장자지만 Excel 형식으로 감지됨. Excel 로더로 전환합니다.") # Excel 로더로 전환 로그
        frames = read_excel_robust(file_path) # Excel 파일로 읽기
        return frames[0] if frames else pd.DataFrame() # 첫 번째 시트 반환 (없으면 빈 DataFrame)

    # 시도할 인코딩 및 구분자 목록 가져오기
    encodings = _detect_encoding(head)
    logger.info(f"인코딩 후보: {encodings}") # 인코딩 후보 로그
    seps = [None, ",", "\t", ";", "|"] # 구분자 후보 (None은 pandas가 자동 감지)

    last_err = None # 마지막 발생 오류 저장용
    # 모든 인코딩과 구분자 조합 시도
    for enc in encodings:
        for sep in seps:
            try:
                logger.debug(f"시도: encoding={enc}, sep={repr(sep)}") # 현재 시도 로그 (디버그 레벨)
                # pandas로 CSV 읽기 시도
                df = pd.read_csv(
                    file_path,
                    encoding=enc, # 현재 인코딩
                    sep=sep, # 현재 구분자 (None이면 자동 감지)
                    engine="python", # 'python' 엔진이 오류 처리에 더 유연함
                    on_bad_lines="warn", # 잘못된 줄은 건너뛰는 대신 경고 로그 출력
                    encoding_errors='ignore' # 디코딩할 수 없는 문자 무시
                )
                # 특정 경우 처리: UTF-16 인코딩인데 탭 구분자(\t)를 None으로 잘못 감지하여 열이 1개만 생긴 경우
                if df.shape[1] == 1 and sep is None and enc.startswith('utf-16'):
                     logger.debug("UTF-16 + 단일 컬럼 감지, 탭 구분자로 재시도") # 탭 구분자로 재시도 로그
                     # 탭 구분자를 명시하여 다시 읽기
                     df2 = pd.read_csv(
                         file_path, encoding=enc, sep="\t", engine="python",
                         on_bad_lines="warn", encoding_errors='ignore'
                     )
                     # 재시도 결과 열이 여러 개면 성공으로 간주
                     if df2.shape[1] > 1:
                         logger.info(f"읽기 성공: encoding={enc}, sep='\\t'") # 성공 로그
                         return df2 # 재시도 결과 반환

                # 일반적인 성공 조건: DataFrame이 비어있지 않고 열이 1개 이상 존재
                if not df.empty and df.shape[1] > 0:
                     logger.info(f"읽기 성공: encoding={enc}, sep={repr(sep)}") # 성공 로그
                     return df # 성공한 DataFrame 반환
            except Exception as e:
                # 현재 조합 실패 시 오류 저장하고 다음 조합 시도
                last_err = e
                logger.debug(f"실패: encoding={enc}, sep={repr(sep)} -> {e}") # 실패 로그 (디버그 레벨)
                continue

    # 모든 조합 실패 시 최종 오류 발생
    raise RuntimeError(f"CSV 로드 최종 실패({os.path.basename(file_path)}): 마지막 오류={last_err}")


def read_excel_robust(file_path: str) -> List[pd.DataFrame]:
    """
    Excel 파일 (xls, xlsx, xlsm)의 모든 시트를 읽어 DataFrame 리스트로 반환합니다.
    각 DataFrame에는 시트 이름을 담은 '__sheet__' 컬럼이 추가됩니다.
    """
    logger.info(f"Excel 로더 시작: {os.path.basename(file_path)}") # Excel 로딩 시작 로그
    try:
        # sheet_name=None으로 모든 시트를 읽어 딕셔너리로 반환 (키: 시트명, 값: DataFrame)
        xls = pd.read_excel(file_path, sheet_name=None)
        frames: List[pd.DataFrame] = [] # 결과를 담을 리스트
        # 각 시트별로 처리
        for sheet_name, df in xls.items():
            if df.empty: # 빈 시트는 건너뛰기
                 continue
            df = df.copy() # 원본 수정을 피하기 위해 복사
            # 맨 앞에 '__sheet__' 컬럼 추가
            df.insert(0, "__sheet__", str(sheet_name))
            frames.append(df) # 리스트에 추가
        logger.info(f"Excel 읽기 성공: {len(frames)}개 시트 로드됨.") # 성공 로그
        return frames # DataFrame 리스트 반환
    except Exception as e:
        # 오류 발생 시 예외 처리
        raise RuntimeError(f"Excel 로드 실패({os.path.basename(file_path)}): {e}")


def load_file_to_documents(file_path: str, text_splitter: RecursiveCharacterTextSplitter) -> List[Document]:
    """
    지원하는 모든 파일 형식(PDF, TXT, CSV, TSV, Excel)을 읽어 LangChain Document 객체 리스트로 변환합니다.
    CSV/Excel의 경우, 데이터 명세서 기반으로 내용을 추출합니다.
    """
    filename = os.path.basename(file_path) # 파일명 추출
    ext = pathlib.Path(filename).suffix.lower() # 소문자 확장자 추출

    # 확장자가 명확하지 않을 때, 파일 헤더 시그니처로 Excel 파일인지 먼저 확인
    head = _read_head(file_path)
    if ext not in SUPPORTED_EXTS and ext not in FORCE_INCLUDE_EXTS:
        kind = _looks_like_excel_bytes(head)
        if kind:
            ext = f".{kind}" # 감지된 Excel 확장자(.xls 또는 .xlsx)로 강제 설정

    # --- PDF 처리 ---
    if ext == ".pdf":
        logger.info(f"PDF 로더 사용: {filename}") # 로더 사용 로그
        loader = PyPDFLoader(file_path) # PDF 로더 초기화
        docs = loader.load_and_split(text_splitter) # 파일 로드 및 텍스트 분할
        for d in docs:
            d.metadata["source"] = filename # 메타데이터에 파일명(source) 보장
        return docs # 분할된 Document 리스트 반환

    # --- TXT 처리 ---
    if ext == ".txt":
        logger.info(f"TXT 로더 사용: {filename}") # 로더 사용 로그
        try:
            # 기본 UTF-8 인코딩으로 시도
            loader = TextLoader(file_path, encoding="utf-8")
            docs = loader.load_and_split(text_splitter)
        except Exception:
            # UTF-8 실패 시, 손상된 문자를 무시하고 강제로 읽기 (errors='ignore')
            logger.warning("UTF-8 읽기 실패, errors='ignore'로 재시도")
            raw = open(file_path, "rb").read().decode("utf-8", errors="ignore")
            # 전체 내용을 하나의 Document로 만들고 분할
            docs = text_splitter.split_documents([Document(page_content=raw, metadata={"source": filename})])
        # 메타데이터에 파일명(source) 보장
        for d in docs:
            d.metadata.setdefault("source", filename)
        return docs

    # --- CSV/TSV 처리 ---
    # FORCE_INCLUDE_EXTS에 포함된 확장자도 이 로직으로 시도
    if ext in (".csv", ".tsv") or ext in FORCE_INCLUDE_EXTS:
        try:
             # 위에서 정의한 강건한 CSV 로더 사용
             df = read_csv_robust(file_path)
             # 컬럼명 시작 부분에 있을 수 있는 BOM 문자 제거 (\ufeff)
             df.rename(columns=lambda c: c.replace("\ufeff", "") if isinstance(c, str) else c, inplace=True)

             raw_documents: List[Document] = [] # Document 객체를 담을 리스트
             # DataFrame의 각 행(row)을 순회
             for idx, row in df.iterrows():
                  if row.isnull().all(): continue # 모든 값이 비어있는 행은 건너뛰기

                  # [수정] 데이터 명세서 기반으로 필요한 컬럼 추출 (Gemini 로직)
                  title = str(row.get('RCP_TTL', '')) # 레시피 제목
                  intro = str(row.get('CKG_IPDC', '')) # 요리 소개
                  material = str(row.get('CKG_MTRL_CN', '')) # 요리 재료 내용

                  # Fallback 로직: 만약 위 3개 컬럼이 모두 비어있다면, 그냥 모든 컬럼 내용을 합침
                  if not title and not intro and not material:
                       page_content = ", ".join([f"{col}: {val}" for col, val in row.astype(str).items()])
                       logger.debug(f"명세서 컬럼 없음(row {idx+1}), 모든 컬럼 사용: {page_content[:100]}...")
                  else:
                       # 추출한 정보들을 의미있는 텍스트 구조로 결합
                       page_content = f"레시피 제목: {title}\n요리 소개: {intro}\n재료: {material}"

                  # 메타데이터 생성 (파일명, 행 번호)
                  metadata = {"source": filename, "row": int(idx) + 1}
                  # Document 객체 생성 및 리스트 추가
                  raw_documents.append(Document(page_content=page_content, metadata=metadata))

             logger.info(f"CSV 처리 완료: {len(raw_documents)}개 행 변환됨.") # 처리 완료 로그
             # 생성된 Document 리스트를 최종적으로 텍스트 분할기에 전달
             return text_splitter.split_documents(raw_documents)
        except Exception as csv_err:
             # CSV 로더가 실패하면, 혹시 구분자 없는 단순 텍스트 파일일 수 있으므로 TXT 로더로 재시도
             logger.warning(f"CSV 로더 실패({filename}): {csv_err}. TXT 로더로 재시도합니다.")
             try:
                  loader = TextLoader(file_path, encoding="utf-8") # 일반 TXT 로더 사용
                  docs = loader.load_and_split(text_splitter)
                  for d in docs: d.metadata.setdefault("source", filename) # source 메타데이터 보장
                  return docs
             except Exception as txt_err:
                  # TXT 로더마저 실패하면 최종 실패 처리 (원본 CSV 오류 발생)
                  logger.error(f"TXT 로더 재시도 실패({filename}): {txt_err}")
                  raise csv_err # 원래 발생했던 CSV 관련 오류를 다시 던짐

    # --- Excel 처리 ---
    if ext in (".xls", ".xlsx", ".xlsm"):
        # 위에서 정의한 강건한 Excel 로더 사용 (모든 시트 읽음)
        frames = read_excel_robust(file_path)
        raw_documents: List[Document] = [] # Document 객체를 담을 리스트
        # 각 시트(DataFrame)별로 처리
        for df in frames:
            # 컬럼명 시작의 BOM 문자 제거
            df.rename(columns=lambda c: c.replace("\ufeff", "") if isinstance(c, str) else c, inplace=True)

            sheet_name = "" # 시트 이름 초기화
            # '__sheet__' 컬럼에서 시트 이름 추출
            if "__sheet__" in df.columns and not df.empty:
                sheet_name = str(df["__sheet__"].iloc[0])
            # '__sheet__' 컬럼은 실제 내용이 아니므로 제거
            df_wo = df.drop(columns=["__sheet__"], errors="ignore")

            # 현재 시트의 각 행(row)을 순회
            for idx, row in df_wo.iterrows():
                if row.isnull().all(): continue # 빈 행 건너뛰기

                # [수정] 데이터 명세서 기반 내용 추출 (Gemini 로직)
                title = str(row.get('RCP_TTL', ''))
                intro = str(row.get('CKG_IPDC', ''))
                material = str(row.get('CKG_MTRL_CN', ''))

                # Fallback 로직: 명세서 컬럼 없으면 모든 컬럼 합침
                if not title and not intro and not material:
                     page_content = ", ".join([f"{col}: {val}" for col, val in row.astype(str).items()])
                else:
                     page_content = f"레시피 제목: {title}\n요리 소개: {intro}\n재료: {material}"

                # 내용 앞에 시트 이름 추가 (예: "[sheet: Sheet1] 레시피 제목: ...")
                if sheet_name:
                    page_content = f"[sheet: {sheet_name}] " + page_content

                # 메타데이터 생성 (파일명, 행 번호, 시트명)
                metadata = {"source": filename, "row": int(idx) + 1, "sheet": sheet_name}
                # Document 객체 생성 및 리스트 추가
                raw_documents.append(Document(page_content=page_content, metadata=metadata))

        logger.info(f"Excel 처리 완료: {len(raw_documents)}개 행 변환됨.") # 처리 완료 로그
        # 생성된 Document 리스트를 최종 분할
        return text_splitter.split_documents(raw_documents)

    # 모든 로더에서 처리하지 못한 경우, 지원하지 않는 형식으로 간주하고 오류 발생
    raise ValueError(f"지원하지 않거나 처리할 수 없는 파일 형식({filename}): {ext}")


# ==============================================================================
# 4. 데이터 처리 (Data Processing - GPU 설정 추가 및 배치 삽입)
# ==============================================================================
def process_and_ingest_data(collection: Collection):
    """Milvus DB에서 이미 처리된 파일을 확인하고, 신규 또는 강제 재처리 대상 파일을 찾아 처리 후 Milvus에 누적 저장합니다."""
    logger.info("데이터베이스에서 이미 처리된 파일 목록을 확인합니다...") # 시작 로그
    try:
        # 컬렉션에 데이터가 있는지 확인
        if collection.num_entities > 0:
            # Milvus에서 기존 데이터의 'source'(파일명) 필드 조회 (성능상 제한 있음)
            results = collection.query(expr="id >= 0", output_fields=["source"], limit=16384)
            # 조회된 파일명들을 Set으로 만들어 중복 제거 및 빠른 조회 가능하게 함
            processed_files: Set[str] = set(item['source'] for item in results)
        else:
            # 컬렉션이 비어있으면 처리된 파일 없음
            processed_files: Set[str] = set()
        logger.info(f"총 {len(processed_files)}개의 파일이 이미 데이터베이스에 존재합니다.") # 결과 로그
    except Exception as e:
        # DB 조회 중 오류 발생 시, 모든 파일을 처리 대상으로 간주 (안전한 방식)
        logger.warning(f"DB에서 기존 파일 목록을 가져오는 중 오류 발생: {e}. 모든 파일을 처리 대상으로 간주합니다.")
        processed_files: Set[str] = set()

    # --- 파일 스캔 로직 (GPT 코드) ---
    scan_log = [] # 스캔 과정을 기록할 리스트
    all_local_files = [] # 로컬 디렉토리에서 처리 후보가 될 파일 리스트
    # DATA_PATH 디렉토리 내 모든 항목 순회
    for f in os.listdir(DATA_PATH):
        full = os.path.join(DATA_PATH, f) # 전체 경로 생성
        # 파일인지 확인 (디렉토리는 건너뛰기)
        if not os.path.isfile(full):
            scan_log.append((f, "skip", "not a file"))
            continue

        ext = pathlib.Path(f).suffix.lower() # 소문자 확장자 추출
        reason = "" # 포함/제외 이유
        include = False # 처리 대상 포함 여부 플래그

        # 1. 지원 확장자인지 확인
        if ext in SUPPORTED_EXTS:
            include = True
            reason = f"ext ok: {ext}"
        else:
            # 2. 지원 확장자가 아니면, Excel 시그니처인지 확인 (잘못된 확장자 처리)
            try:
                head = _read_head(full)
                if _looks_like_excel_bytes(head):
                    include = True
                    reason = "excel signature"
                else:
                    reason = f"unsupported ext: {ext}"
            except Exception as e:
                reason = f"head read err: {e}" # 헤더 읽기 오류 시 로그

        # 3. 위 조건에 해당 안되더라도, 강제 포함 확장자(FORCE_INCLUDE_EXTS)면 포함
        if not include and ext in FORCE_INCLUDE_EXTS:
            include = True
            reason = f"force include: {ext}"

        # 스캔 결과 기록 및 처리 후보 리스트 추가
        scan_log.append((f, "include" if include else "skip", reason))
        if include:
            all_local_files.append(f)

    # 스캔 결과 상세 로그 출력
    for name, act, why in scan_log:
        logger.info(f"[SCAN] {act.upper():7s} | {name} | {why}")

    # --- 처리 대상 파일 최종 결정 (GPT 코드) ---
    # 조건: (DB에 없는 파일) 또는 (강제 재처리 목록에 있는 파일)
    files_to_process = [f for f in all_local_files if (f not in processed_files) or (f in FORCE_REPROCESS)]
    logger.info(f"스캔 결과: 총 {len(all_local_files)}개 후보 / 신규 처리 {len(files_to_process)}개") # 요약 로그
    # 처리할 파일이 없으면 함수 종료
    if not files_to_process:
         logger.info("새로 추가/변경되거나 강제 재처리할 파일이 없습니다. 작업을 종료합니다.")
         return
    logger.info(f"처리 대상 파일 목록: {files_to_process}") # 처리 대상 파일명 목록 로그


    # --- [수정됨] 임베딩 모델 및 텍스트 분할기 초기화 (GPU 설정 추가) ---
    logger.info(f"임베딩 모델을 초기화합니다: {EMBEDDING_MODEL}") # 시작 로그
    
    # [수정] GPU 사용 설정 추가
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    logger.info(f"임베딩 계산에 사용할 장치: {device.upper()}") # 사용할 장치(CPU/GPU) 로그
    
    # model_kwargs={'device': device} 를 추가하여 GPU 또는 CPU 지정
    embeddings = HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL,
        model_kwargs={'device': device}
    )
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=100) # 텍스트 분할기 객체 생성

    # --- 각 파일 처리 루프 ---
    for filename in tqdm(files_to_process, desc="신규 파일 처리 중"): # tqdm으로 진행률 표시
        file_path = os.path.join(DATA_PATH, filename) # 전체 파일 경로
        try:
            logger.info(f"'{filename}' 로딩 시작...") # 파일 로딩 시작 로그
            # 1) 통합 파일 로더를 사용하여 파일을 읽고 Document 리스트로 변환 (분할 포함)
            all_documents = load_file_to_documents(file_path, text_splitter)

            # 내용이 없는 경우 건너뛰기
            if not all_documents:
                logger.warning(f"파일 '{filename}'에서 처리할 내용을 찾을 수 없습니다.")
                continue

            # 2) 임베딩 생성
            logger.info(f"'{filename}' 임베딩 시작 ({len(all_documents)}개 조각)...") # 임베딩 시작 로그
            texts = [d.page_content for d in all_documents] # Document에서 텍스트 내용만 추출
            vectors = embeddings.embed_documents(texts) # 임베딩 계산 수행 (GPU 사용 시 여기서 빨라짐)

            # 3) Milvus 저장을 위한 메타데이터 준비
            sources = [d.metadata.get("source", filename) for d in all_documents] # source (파일명) 리스트
            # page (PDF 페이지) 또는 row (CSV/Excel 행 번호) 리스트 (없으면 0)
            pages = [d.metadata.get("page", d.metadata.get("row", 0)) for d in all_documents]

            # 4) [수정됨] Milvus 배치(Batch) 삽입
            logger.info(f"'{filename}' Milvus 저장 시작 ({MILVUS_BATCH_SIZE}개씩 나누어 저장)...")
            total_inserted = 0
            # 전체 데이터를 배치 크기만큼 나누어 반복 처리
            for i in range(0, len(all_documents), MILVUS_BATCH_SIZE):
                # 현재 배치의 시작과 끝 인덱스 계산
                batch_end = min(i + MILVUS_BATCH_SIZE, len(all_documents))
                
                # 현재 배치에 해당하는 데이터 추출
                batch_sources = sources[i:batch_end]
                batch_pages = pages[i:batch_end]
                batch_texts = texts[i:batch_end] # texts 필드도 함께 전달
                batch_vectors = vectors[i:batch_end]
                
                # Milvus에 현재 배치 삽입
                try:
                    collection.insert([batch_sources, batch_pages, batch_texts, batch_vectors])
                    total_inserted += len(batch_sources)
                    logger.debug(f"  - 배치 {i // MILVUS_BATCH_SIZE + 1} ({len(batch_sources)}개) 저장 성공.")
                except Exception as batch_e:
                    logger.error(f"  - 배치 {i // MILVUS_BATCH_SIZE + 1} 저장 중 오류 발생: {batch_e}")
                    continue # 오류난 배치 건너뛰고 계속

            logger.info(f"파일 '{filename}'의 처리 및 저장이 완료되었습니다. (총 {total_inserted}/{len(all_documents)}개 조각 저장됨)")
        
        except Exception as e:
            # 파일 처리 중 발생하는 모든 예외 처리
            logger.error(f"파일 '{filename}' 처리 중 오류 발생: {e}")
            logger.exception("상세 오류:") # 오류 스택 트레이스 포함하여 로그 기록

    # --- 최종 Flush ---
    logger.info("모든 신규 파일의 처리가 완료되었습니다.") # 모든 파일 처리 완료 로그
    collection.flush() # Milvus에 삽입된 데이터를 디스크에 최종 저장 (필수)
    logger.info(f"'{COLLECTION_NAME}' 컬렉션에 데이터를 저장(Flush)했습니다.")


# ==============================================================================
# 5. 메인 실행 함수 (Main Execution Function)
# ==============================================================================
def main():
    """스크립트의 메인 실행 흐름을 정의합니다."""
    logger.info("데이터 처리 및 저장 프로세스를 시작합니다...") # 스크립트 시작 로그
    milvus_collection = None # finally 블록에서 사용하기 위해 None으로 초기화
    try:
         # Milvus 연결 및 컬렉션 준비
         milvus_collection = setup_milvus_collection()
         # 데이터 처리 및 저장 함수 호출
         process_and_ingest_data(milvus_collection)
    except Exception as e:
         # 예상치 못한 심각한 오류 발생 시 로그 기록
         logger.error(f"스크립트 실행 중 심각한 오류 발생: {e}")
         logger.exception("상세 오류:") # 스택 트레이스 포함
    finally:
         # 오류 발생 여부와 관계없이 항상 실행되는 블록
         # Milvus 연결이 열려있으면 닫기
         if connections.has_connection("default"):
              connections.disconnect("default")
              logger.info("Milvus 연결을 종료합니다.") # 연결 종료 로그
         logger.info("프로세스가 완료되었습니다.") # 스크립트 종료 로그


# ==============================================================================
# 6. (시각화) 데이터 수집 워크플로우 정의 (Visualization - GPT 코드)
# ==============================================================================
class IngestionState(TypedDict): # LangGraph 상태 정의
    status: str

# 시각화 그래프의 각 단계를 나타내는 더미(dummy) 노드 함수들
def load_files_node(state: IngestionState):
    logger.info("[Workflow Step] 1. 파일 로드")
    return {"status": "files_loaded"}

def split_text_node(state: IngestionState):
    logger.info("[Workflow Step] 2. 텍스트 분할 (스플릿)")
    return {"status": "text_split"}

def ingest_to_milvus_node(state: IngestionState):
    logger.info("[Workflow Step] 3. Milvus DB 저장 (임베딩)")
    return {"status": "ingested"}

# 시각화용 LangGraph 워크플로우를 생성하고 컴파일하는 함수
def create_ingestion_workflow():
    workflow = StateGraph(IngestionState) # 그래프 초기화
    # 노드 추가
    workflow.add_node("load", load_files_node)
    workflow.add_node("split", split_text_node)
    workflow.add_node("ingest", ingest_to_milvus_node)
    # 엣지(흐름) 정의
    workflow.set_entry_point("load") # 시작점 설정
    workflow.add_edge("load", "split") # load -> split
    workflow.add_edge("split", "ingest") # split -> ingest
    workflow.add_edge("ingest", END) # ingest -> 종료
    logger.info("시각화용 'Ingestion Workflow'를 컴파일합니다.") # 컴파일 로그
    return workflow.compile() # 그래프 컴파일 및 반환


# 스크립트 시작 시 시각화용 그래프 객체 생성
try:
    rag_app = create_ingestion_workflow()
except Exception as graph_err:
     logger.error(f"워크플로우 그래프 생성 실패: {graph_err}") # 생성 실패 시 로그
     rag_app = None # 실패 시 None으로 설정하여 이후 시각화 단계 건너뛰도록 함


# ==============================================================================
# 7. 메인 실행 블록 (Main Execution Block - GPT 코드)
# ==============================================================================
if __name__ == "__main__": # 스크립트가 직접 실행될 때만 아래 코드 실행
    # 1) 워크플로우 시각화 PNG 파일 생성
    if rag_app: # 그래프 객체가 성공적으로 생성되었는지 확인
         try:
              graph_image_path = "db_load_workflow.png" # 저장할 이미지 파일명
              # 그래프 구조를 Mermaid 형식으로 그려 PNG 파일로 저장
              with open(graph_image_path, "wb") as f:
                   f.write(rag_app.get_graph().draw_mermaid_png())
              logger.info(f"LangGraph 구조가 '{graph_image_path}' 파일로 저장되었습니다.") # 성공 로그
         except Exception as e:
              # 시각화 중 오류 발생 시 경고 로그
              logger.warning(f"그래프 시각화 중 오류가 발생했습니다: {e}")
    else:
         # 그래프 객체 생성 실패 시 시각화 건너뛰기 로그
         logger.warning("워크플로우 객체(rag_app)가 없어 시각화를 건너<0xEB><0x9A><0x8E>니다.")

    # 2) 실제 데이터 처리 및 저장 작업 실행
    main() # 메인 실행 함수 호출