/** Shared label block for Semi form rows: bold title + optional description. */
export function PreferenceLabel({ title, description }: {
  title: string
  /** 说明文案；写成 `| undefined` 是因为本仓库开启 `exactOptionalPropertyTypes`。 */
  description?: string | undefined
}) {
  return (
    <span className="dsh-codebuddy-form-label">
      <strong className="dsh-codebuddy-form-label-title">{title}</strong>
      {description !== undefined && description.length > 0
        ? <span className="dsh-codebuddy-form-label-description">{description}</span>
        : null}
    </span>
  )
}
