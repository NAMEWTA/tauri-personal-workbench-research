---
source_change: 2026-09-02-consolidate-project-knowledge
promoted_at: 2026-09-02
---

# Retrieval

**全局搜索**：面向档案、任务和附件名的统一检索能力；附件命中导航到其 owner 档案。它不是任意全表搜索或远程搜索服务。

**搜索索引**：由源实体派生的 SQLite FTS5 trigram 投影；短查询或 FTS 失败时回退 LIKE。索引可以重建，不是业务事实源，也不承诺独立的模糊排序引擎。
