export type MarkdownViewProps = {
  content: string;
  /**
   * 本轮回答可用的来源条数。
   *
   * 用于把越界的 `[来源N]` 降级为纯文本：模型可能把**上一轮**的角标抄进本轮回答
   * （历史消息也在 prompt 里），此时 N 索引不到本轮的 sources，
   * 渲染成按钮会让用户点开一条错误的来源。
   */
  sourceCount?: number;
};
