import type { MidsceneLocaleKey } from './locales.ts'

/**
 * 한국어 사전(键集合与 zh 一致，由类型约束).
 *
 * 键集合由 `MidsceneLocaleKey` 在编译期约束，缺键或多键都会 typecheck 失败。
 */
export const ko: { [Key in MidsceneLocaleKey]: string } = {
  sectionTitle: 'Midscene 연동 설정',
  sectionHint: 'Midscene은 로컬 브리지 서비스를 통해 DSH에 설정된 모델을 사용합니다. 모델 API 키가 필요하지 않습니다.',
  apiKeyLabel: '연결 키',
  apiKeyHint: '브리지 서비스의 연결 키이며 모델 키가 아닙니다. 다시 생성하면 아래 연결 설정(명령줄 .env와 브라우저 확장 프로그램 두 곳)도 함께 업데이트해야 합니다.',
  regenerate: '무작위로 다시 생성',
  regenerating: '생성 중…',
  customKey: '사용자 지정 키',
  customKeyPlaceholder: '사용자 지정 키 입력',
  save: '저장',
  saving: '저장 중…',
  cancel: '취소',
  copy: '복사',
  copied: '복사했습니다',
  modelsLabel: '역할별 모델',
  modelsHint: 'Midscene은 네 가지 역할로 모델을 사용합니다. 기본 역할이 모든 기능을 제공하고, 나머지 세 가지 선택 역할은 비워 두면 기본을 따릅니다. 이미지를 이해할 수 있는 모델만 표시됩니다(Midscene은 스크린샷으로 페이지를 이해합니다). 보통은 기본 설정만으로 충분하며, 요소 탐색이 불안정하거나 분기가 많은 긴 흐름을 다룰 때 해당 역할에 모델을 따로 설정하면 됩니다.',
  modelsPlaceholder: 'Midscene에 사용할 이미지 인식 모델 선택',
  modelsEmpty: '지정 안 함(DSH 세션 모델을 따름)',
  modelsSearch: '모델 검색',
  modelsNoneSelected: '지정 안 함(DSH 세션 모델을 따름)',
  intentInheritPlaceholder: '지정 안 함(기본 역할 사용)',
  intentDefault: '기본',
  intentLocate: '위치 탐색',
  intentPlanning: '계획',
  intentInsight: '페이지 이해',
  intentResolved: '현재 사용 중',
  intentNoModel: '사용 가능한 이미지 인식 모델이 없습니다',
  intentInherited: '기본 따름',
  modelsStale: '카탈로그에 없음',
  modelsUnavailable: 'DSH에 Midscene이 사용할 수 있는 이미지 인식 모델이 없습니다. 먼저 DSH에서 공급자를 설치하고 로그인한 뒤(모델이 이미지 입력을 지원해야 합니다) 이 페이지로 돌아와 새로 고치세요.',
  addModel: '모델 추가',
  removeModel: '제거',
  envLabel: '연결 설정(명령줄 .env 또는 Midscene 브라우저 확장 프로그램)',
  envHint: '보통은 여기서 받은 내용을 그대로 사용합니다. 명령줄에서 실행할 때는 작업 디렉터리에 .env로 저장하세요. 브리지 모드에서는 추론이 스크립트를 실행하는 쪽에서 이루어지므로 Chrome의 Midscene 확장 프로그램에 모델을 설정할 필요가 없습니다. 확장 프로그램의 Playground를 사용할 때만 이 내용을 사이드바 설정에 붙여넣으면 됩니다. 기본은 네 줄이며, 전용 역할에 모델을 설정하면 해당 변수 그룹이 자동으로 추가됩니다. 서드파티 모델 키는 필요하지 않습니다.',
  envCopy: '연결 설정 복사',
  loading: '현재 설정을 읽는 중…',
  loadFailed: '설정을 읽지 못했습니다',
  saveFailed: '저장에 실패했습니다',
  reload: '다시 시도',
}
