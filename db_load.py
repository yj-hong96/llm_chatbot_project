import os
import logging
from tqdm import tqdm
from langchain_community.document_loaders import PyPDFLoader, CSVLoader, TextLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from pymilvus import connections, utility, FieldSchema, CollectionSchema, DataType, Collection

# ==============================================================================
# 0. 로깅 설정
# ==============================================================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("ingest_data.log", encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


# ==============================================================================
# 1. 설정
# ==============================================================================
MILVUS_HOST = "localhost"
MILVUS_PORT = "19530"
COLLECTION_NAME = "farmer"
DIMENSION = 768
EMBEDDING_MODEL = "jhgan/ko-sroberta-multitask"
DATA_PATH = r"D:\vsc\crop_info"


# ==============================================================================
# 2. Milvus 연결 및 컬렉션 준비 (스키마 업데이트)
# ==============================================================================
def setup_milvus_collection():
    """Milvus에 연결하고, 최신 스키마로 컬렉션을 준비합니다."""
    try:
        logger.info(f"Milvus에 연결을 시도합니다... (주소: {MILVUS_HOST}:{MILVUS_PORT})")
        connections.connect("default", host=MILVUS_HOST, port=MILVUS_PORT)
        logger.info("Milvus에 성공적으로 연결되었습니다.")
    except Exception as e:
        logger.error(f"Milvus 연결에 실패했습니다: {e}")
        exit()

    # [중요] 메타데이터(페이지 번호) 저장을 위해 새로운 스키마를 정의합니다.
    fields = [
        FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=True),
        FieldSchema(name="source", dtype=DataType.VARCHAR, max_length=1024),
        FieldSchema(name="page", dtype=DataType.INT32), # 페이지 번호 필드 추가
        FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=65535),
        FieldSchema(name="vector", dtype=DataType.FLOAT_VECTOR, dim=DIMENSION)
    ]
    schema = CollectionSchema(fields, description="Document Collection with metadata")

    # 기존 컬렉션이 있는지 확인하고, 스키마가 다르면 재생성합니다.
    if utility.has_collection(COLLECTION_NAME):
        existing_collection = Collection(name=COLLECTION_NAME)
        # 필드 이름만 간단히 비교하여 스키마 변경 여부 확인
        if set(field.name for field in existing_collection.schema.fields) != set(field.name for field in schema.fields):
            logger.warning("기존 컬렉션의 스키마가 변경되어 삭제 후 재생성합니다.")
            utility.drop_collection(COLLECTION_NAME)
            collection = Collection(name=COLLECTION_NAME, schema=schema)
            logger.info("컬렉션이 성공적으로 생성되었습니다.")
            create_index(collection)
        else:
            logger.info(f"기존 컬렉션 '{COLLECTION_NAME}'을(를) 사용합니다.")
            collection = existing_collection
    else:
        logger.info(f"컬렉션 '{COLLECTION_NAME}'이(가) 없어 새로 생성합니다.")
        collection = Collection(name=COLLECTION_NAME, schema=schema)
        logger.info("컬렉션이 성공적으로 생성되었습니다.")
        create_index(collection)

    collection.load()
    logger.info("컬렉션을 메모리에 로드했습니다. 검색이 준비되었습니다.")
    return collection

def create_index(collection: Collection):
    """새 컬렉션에 대한 벡터 인덱스를 생성합니다."""
    logger.info("새 컬렉션에 대한 벡터 인덱스를 생성합니다...")
    index_params = {
        "metric_type": "L2", "index_type": "IVF_FLAT", "params": {"nlist": 128}
    }
    collection.create_index(field_name="vector", index_params=index_params)
    logger.info("벡터 필드에 인덱스를 생성했습니다.")


# ==============================================================================
# 3. 데이터 처리 (파일 단위 배치 처리 및 메타데이터 추가)
# ==============================================================================
def process_and_ingest_data(collection: Collection):
    """신규 문서를 찾아 파일 단위로 처리하고 Milvus에 누적 저장합니다."""
    
    # --- 3-1. DB에서 이미 처리된 파일 목록 가져오기 ---
    logger.info("데이터베이스에서 이미 처리된 파일 목록을 확인합니다...")
    try:
        # DB가 비어있지 않다면 기존 파일 목록을 가져옵니다.
        if collection.num_entities > 0:
            results = collection.query(expr="id >= 0", output_fields=["source"], limit=16384)
            processed_files = set(item['source'] for item in results)
        else:
            processed_files = set()
        logger.info(f"총 {len(processed_files)}개의 파일이 이미 데이터베이스에 존재합니다.")
    except Exception as e:
        logger.warning(f"DB에서 기존 파일 목록을 가져오는 중 오류 발생: {e}. 모든 파일을 처리 대상으로 간주합니다.")
        processed_files = set()

    # --- 3-2. 로컬 폴더에서 신규 파일만 필터링 ---
    all_local_files = [f for f in os.listdir(DATA_PATH) if f.lower().endswith((".pdf", ".csv", ".txt"))]
    files_to_process = [f for f in all_local_files if f not in processed_files]

    if not files_to_process:
        logger.info("새로 추가된 파일이 없습니다. 작업을 종료합니다.")
        return
    
    logger.info(f"총 {len(files_to_process)}개의 신규 파일을 처리합니다: {files_to_process}")

    # --- 3-3. 신규 파일 처리 (파일 단위로 로드 -> 임베딩 -> 저장) ---
    logger.info(f"임베딩 모델을 초기화합니다: {EMBEDDING_MODEL}")
    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=100)
    
    for filename in tqdm(files_to_process, desc="신규 파일 처리 중"):
        file_path = os.path.join(DATA_PATH, filename)
        try:
            # 파일 로드
            if filename.lower().endswith(".pdf"):
                loader = PyPDFLoader(file_path)
            elif filename.lower().endswith(".csv"):
                # CSV 파일 로딩 오류 해결을 위해 인코딩 추가
                loader = CSVLoader(file_path, encoding='cp949') 
            elif filename.lower().endswith(".txt"):
                loader = TextLoader(file_path, encoding='utf-8')
            
            # 파일 분할
            documents = loader.load_and_split(text_splitter)
            if not documents:
                logger.warning(f"파일 '{filename}'에서 처리할 내용을 찾을 수 없습니다.")
                continue

            # 임베딩
            texts = [chunk.page_content for chunk in documents]
            vectors = embeddings.embed_documents(texts)
            
            # 메타데이터 준비
            sources = [chunk.metadata.get('source', 'unknown').split(os.sep)[-1] for chunk in documents]
            pages = [chunk.metadata.get('page', 0) for chunk in documents]

            # DB에 삽입 (파일 하나 단위로)
            collection.insert([sources, pages, texts, vectors])
            logger.info(f"파일 '{filename}'의 처리 및 저장이 완료되었습니다. ({len(documents)}개 조각)")

        except Exception as e:
            logger.error(f"파일 '{filename}' 처리 중 오류가 발생했습니다: {e}")
    
    logger.info("모든 신규 파일의 저장이 완료되었습니다.")
    collection.flush()
    logger.info("데이터를 디스크에 저장(Flush)했습니다.")

# ==============================================================================
# 4. 메인 실행 함수 정의
# ==============================================================================
def main():
    """스크립트의 메인 실행 흐름을 정의합니다."""
    logger.info("데이터 처리 및 저장 프로세스를 시작합니다...")
    milvus_collection = setup_milvus_collection()
    process_and_ingest_data(milvus_collection)
    connections.disconnect("default")
    logger.info("프로세스가 완료되어 Milvus 연결을 종료합니다.")


# ==============================================================================
# 5. 메인 실행 블록
# ==============================================================================
if __name__ == "__main__":
    main()

