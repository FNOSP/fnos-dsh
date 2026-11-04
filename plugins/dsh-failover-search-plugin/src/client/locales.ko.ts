import type { UsageLocaleKey } from './locales.ts'

/**
 * 한국어 사전(键集合与 zh 一致，由类型约束).
 *
 * 键集合由 `UsageLocaleKey` 在编译期约束，缺键或多键都会 typecheck 失败。
 */
export const ko: { [Key in UsageLocaleKey]: string } = {
  // 섹션 제목
  sectionTitle: '플랫폼 사용량',
  refreshHint: '사용량은 플랫폼의 무료 조회 엔드포인트에서 가져오며 백그라운드에서 자동으로 갱신됩니다',
  refresh: '새로고침',
  refreshing: '새로고침 중',
  toggleOn: '스마트 검색',
  loading: '사용량 스냅샷을 읽는 중…',
  unavailable: '사용량 스냅샷을 사용할 수 없음',
  stale: '스냅샷이 오래되었습니다. 검색은 정상적으로 실행됩니다',
  fetchedAt: '가져온 시각',
  tinyfishTitle: 'TinyFish',
  tavilyTitle: 'Tavily',
  noAccount: '계정 미설정',
  balance: '지갑 잔액',
  autoReload: '자동 충전',
  searchRate: '검색 단가',
  keyUsage: 'Key 사용량',
  plan: '플랜',
  planUsage: '플랜 사용량',
  paygoUsage: '종량제 사용량',

  // 공식 설정 폼의 프레임 문구
  formUnavailable: '현재 DSH 배포는 이 페이지에 이 플러그인의 설정을 제공하지 않습니다.',
  formReadOnly: '현재 배포는 설정을 읽기 전용으로 저장하므로 변경할 수 없습니다.',
  formSaveFailed: '저장이 적용되지 않았습니다. 입력 내용을 확인하고 다시 시도하세요.',
  formSave: '저장',
  formSaving: '저장 중…',
  formOverridden: '재정의됨',
  formReset: '초기화',
  formInvalidNumber: '양의 정수를 입력하세요',

  // 설정 항목
  accountsTitle: '플랫폼 계정',
  accountsHint: '플랫폼마다 여러 개의 key를 설정할 수 있으며, 요청은 같은 플랫폼의 계정 사이에서 돌아가며 분산됩니다. key는 암호화되어 저장되며 다시 표시되지 않습니다.',
  accountKey: 'API key',
  accountKeyPlaceholder: '플랫폼 API key 붙여넣기',
  accountLabel: '표시 이름',
  accountLabelPlaceholderTinyfish: '예: tinyfish-1',
  accountLabelPlaceholderTavily: '예: tavily-1',
  accountLabelPlaceholder: '예: platform-1',
  accountAdd: '계정 추가',
  accountRemove: '삭제',
  accountCancel: '취소',
  accountConfirm: '추가',
  accountEmpty: '계정이 설정되지 않아 이 플랫폼은 현재 비활성 상태입니다.',
  accountKeepBlank: '비워 두면 저장된 key를 변경하지 않습니다.',
  accountIndex: '계정',
  accountKeySet: 'key 저장됨',
  accountEdit: '편집',
  accountCopy: 'key 복사',
  accountCopied: '복사했습니다',
  accountCopyFailed: '복사 실패',
  accountSave: '저장',
  accountEditKeyPlaceholder: '비워 두면 이 key를 변경하지 않습니다',
  accountEditHint: '비워 두면 기존 key를 유지합니다. 표시 이름을 비우면 표시 이름이 삭제됩니다.',

  orderTitle: '전환과 분산',
  sourceOrder: '소스 순서',
  sourceOrderHint: '소스를 순서대로 시도합니다. 공식 검색은 항상 마지막 대체 수단으로 참여합니다.',
  sourceOrderOfficial: '공식 검색',
  timeoutMs: '소스별 타임아웃(밀리초)',
  timeoutMsHint: '계정 한 건의 검색 요청 타임아웃이며, 도구 전체 예산보다 작아야 합니다.',
  samePlatformRetry: '같은 플랫폼에서 재시도',
  samePlatformRetryHint: '한 계정이 실패한 뒤 같은 플랫폼의 다른 계정도 시도할지 여부입니다.',

  usageTitle: '사용량 표시와 사전 확인',
  usageRefreshMinutes: '사용량 갱신 간격(분)',
  usageRefreshMinutesHint: '사용량 스냅샷을 백그라운드에서 갱신하는 주기이며 1~60 범위입니다.',
  requestProbe: '요청 전 확인',
  requestProbeHint: '사용량 스냅샷을 기준으로 쿼터가 부족한 계정을 미리 건너뜁니다.',
  on: '켜기',
  off: '끄기',
}
