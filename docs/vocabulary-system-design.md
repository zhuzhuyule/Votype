# 词汇管理系统设计文档

## 概述

三层词汇管理系统，用于从日常语音中提取、管理和优化热词库。

## 数据库架构

### 1. daily_vocabulary (每日词库)

每天AI分析生成的独立词库，用户可手动编辑。

```sql
CREATE TABLE IF NOT EXISTS daily_vocabulary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,                    -- 日期 YYYY-MM-DD
    word TEXT NOT NULL,                     -- 词汇
    context_type TEXT,                      -- 上下文类型: work, life, learning, entertainment, etc.
    frequency INTEGER DEFAULT 1,            -- 当天出现次数（可选）
    source TEXT DEFAULT 'ai_extracted',     -- 来源: ai_extracted, user_added
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(date, word)                      -- 同一天同一词汇只记录一次
);

CREATE INDEX idx_daily_vocabulary_date ON daily_vocabulary(date);
CREATE INDEX idx_daily_vocabulary_word ON daily_vocabulary(word);
CREATE INDEX idx_daily_vocabulary_context_type ON daily_vocabulary(context_type);
```

### 2. vocabulary_candidates (候选池 - 视图)

动态生成的聚合视图，不存储实际数据。

```sql
-- 候选词库查询（运行时动态生成）
SELECT
    dv.word,
    dv.context_type,
    COUNT(DISTINCT dv.date) as days_count,           -- 出现天数
    SUM(dv.frequency) as total_frequency,            -- 总出现次数
    MAX(dv.date) as last_seen_date,                  -- 最后出现日期
    MIN(dv.date) as first_seen_date                  -- 首次出现日期
FROM daily_vocabulary dv
LEFT JOIN vocabulary v ON dv.word = v.word
WHERE v.word IS NULL                                 -- 排除已在热词库的词
GROUP BY dv.word, dv.context_type
HAVING days_count >= 2                               -- 至少出现2天（可配置）
ORDER BY days_count DESC, total_frequency DESC;
```

### 3. vocabulary (热词库)

最终确认的热词，提供给语音识别系统。

```sql
-- 扩展现有 vocabulary 表
ALTER TABLE vocabulary ADD COLUMN context_type TEXT;
ALTER TABLE vocabulary ADD COLUMN total_occurrences INTEGER DEFAULT 0;
ALTER TABLE vocabulary ADD COLUMN days_count INTEGER DEFAULT 0;
ALTER TABLE vocabulary ADD COLUMN promotion_type TEXT DEFAULT 'manual';  -- manual, auto
ALTER TABLE vocabulary ADD COLUMN promoted_at INTEGER;
ALTER TABLE vocabulary ADD COLUMN promoted_from_date TEXT;  -- 从哪天开始统计
```

## API 设计

### 1. 每日词库管理

```rust
// 存储AI提取的每日词汇
pub async fn store_daily_vocabulary(
    date: &str,
    words: Vec<DailyVocabularyItem>
) -> Result<()>

// 获取指定日期的词库
pub async fn get_daily_vocabulary(
    date: &str
) -> Result<Vec<DailyVocabularyItem>>

// 用户手动添加词汇
pub async fn add_word_to_daily_vocabulary(
    date: &str,
    word: &str,
    context_type: Option<&str>
) -> Result<()>

// 用户删除词汇
pub async fn remove_word_from_daily_vocabulary(
    date: &str,
    word: &str
) -> Result<()>

// 更新词汇类型
pub async fn update_word_context_type(
    date: &str,
    word: &str,
    context_type: &str
) -> Result<()>
```

### 2. 候选词库查询

```rust
// 获取候选词库（动态聚合）
pub async fn get_vocabulary_candidates(
    min_days: Option<i32>,           // 最小出现天数
    min_frequency: Option<i32>,      // 最小总频率
    context_type: Option<&str>,      // 按类型筛选
    date_range: Option<(String, String)>  // 日期范围
) -> Result<Vec<VocabularyCandidateItem>>

// 候选词详细信息
pub async fn get_candidate_details(
    word: &str
) -> Result<CandidateDetails>  // 包含每天的出现记录
```

### 3. 热词晋升

```rust
// 手动晋升为热词
pub async fn promote_to_hotword(
    word: &str,
    context_type: &str,
    weight: Option<f64>
) -> Result<()>

// 批量手动晋升
pub async fn batch_promote_to_hotword(
    words: Vec<PromoteRequest>
) -> Result<()>

// 自动晋升检查（定期任务）
pub async fn auto_promote_candidates(
    threshold_days: i32,      // 天数阈值，如 7
    threshold_frequency: i32  // 频率阈值，如 20
) -> Result<Vec<String>>  // 返回被晋升的词汇列表
```

### 4. 热词库管理

```rust
// 查询热词库
pub async fn get_hotwords(
    context_type: Option<&str>
) -> Result<Vec<HotwordItem>>

// 更新热词属性
pub async fn update_hotword(
    word: &str,
    updates: HotwordUpdate
) -> Result<()>

// 从热词库移除
pub async fn remove_from_hotword(
    word: &str
) -> Result<()>
```

## 数据结构

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DailyVocabularyItem {
    pub id: i64,
    pub date: String,
    pub word: String,
    pub context_type: Option<String>,  // work, life, learning, entertainment
    pub frequency: i32,
    pub source: String,  // ai_extracted, user_added
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VocabularyCandidateItem {
    pub word: String,
    pub context_type: Option<String>,
    pub days_count: i32,           // 出现天数
    pub total_frequency: i32,      // 总频率
    pub first_seen_date: String,
    pub last_seen_date: String,
    pub promotion_score: f64,      // 晋升评分（综合天数和频率）
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HotwordItem {
    pub word: String,
    pub context_type: Option<String>,
    pub weight: f64,
    pub total_occurrences: i32,
    pub days_count: i32,
    pub promotion_type: String,  // manual, auto
    pub promoted_at: i64,
    pub promoted_from_date: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CandidateDetails {
    pub word: String,
    pub context_type: Option<String>,
    pub daily_records: Vec<DailyRecord>,  // 每天的记录
    pub statistics: VocabularyCandidateItem,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DailyRecord {
    pub date: String,
    pub frequency: i32,
}
```

## 上下文类型 (Context Types)

建议的分类：

- `work` - 工作相关（项目名、技术术语、同事名字等）
- `life` - 生活相关（购物、餐饮、日常活动等）
- `learning` - 学习相关（课程、书籍、概念等）
- `entertainment` - 娱乐相关（游戏、影视、音乐等）
- `people` - 人名
- `location` - 地点
- `other` - 其他

## 集成点

### 1. AI 分析集成

在日报 AI 分析中：

- 提取 `vocabulary_extracted` 字段
- 同时分析每个词的上下文类型
- 存储到 `daily_vocabulary` 表

### 2. 语音识别集成

语音识别系统从 `vocabulary` 表读取热词：

- 按 `context_type` 分组
- 按 `weight` 排序
- 实时更新到识别引擎

## 工作流程

### 日常流程

1. **每日分析**（自动）
   - AI 分析当天语音 → 提取词汇 + 类型
   - 存入 `daily_vocabulary`

2. **用户审阅**（手动）
   - 查看当天词库
   - 删除错误识别的词
   - 添加遗漏的重要词
   - 修正词汇类型标签

3. **候选生成**（动态）
   - 用户打开候选页面
   - 系统实时聚合所有日期数据
   - 显示高频词 + 统计信息

4. **晋升热词**（手动/自动）
   - 用户手动选择重要词晋升
   - 或系统定期自动晋升达标词

5. **热词应用**（自动）
   - 更新到语音识别引擎
   - 提高识别准确度

## 性能考虑

### 优化策略

1. **索引优化**
   - date, word, context_type 字段建立索引
   - 加速聚合查询

2. **缓存策略**
   - 候选词库查询结果缓存（5分钟）
   - 热词库全量缓存（内存）

3. **分页支持**
   - 候选词库支持分页查询
   - 避免一次加载过多数据

4. **定期清理**
   - 可选：清理 N 天前的 daily_vocabulary
   - 保留统计数据到热词库

## 扩展功能

### 未来可能的增强

1. **词汇关系图**
   - 分析词汇之间的共现关系
   - 可视化展示

2. **智能推荐**
   - 基于上下文推荐相关词汇
   - 自动补全

3. **导入/导出**
   - 支持批量导入专业词库
   - 导出用户词库备份

4. **多语言支持**
   - 分语言管理词库
   - 支持混合语音识别
