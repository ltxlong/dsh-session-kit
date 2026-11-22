/**
 * state-words.js —— 状态引擎的内置词表种子
 *
 * 档位自带方向（轻加/轻减/中加/中减/重加/重减），负性偏向直接落在数值里，
 * 不需要额外的"方向"或"偏向系数"参数。
 */

/* 档位数值：按维度不同（§5.2）。
   同一句"谢谢"对好感是 +2，对心情不是——所以数值表必须二维。 */
export const TIER_VALUES = Object.freeze({
  favor: Object.freeze({ 轻加: 2, 轻减: -3, 中加: 6, 中减: -12, 重加: 15, 重减: -45 }),
  mood: Object.freeze({ 轻加: 3, 轻减: -4, 中加: 8, 中减: -12, 重加: 15, 重减: -22 }),
  energy: Object.freeze({ 轻加: 3, 轻减: -5, 中加: 8, 中减: -14, 重加: 15, 重减: -30 })
});

/* 自定义维度没有专属数值表时，退回心情的档位值（量级最中性） */
export const DEFAULT_TIER_VALUES = TIER_VALUES.mood;

/* 单轮单维度封顶 = 最重单档的绝对值（好感「重减」45）。
   必须 ≥ 最重单档，否则 45 会被截成更小的数，档位表形同虚设。 */
export const NUDGE_CAP = 45;

/* 缓和词：命中词所在分句里出现这些，说明是在委婉表达，降一档。
   见设计 §5.4。 */
export const SOFTEN_WORDS = Object.freeze(['这里', '可能', '也许', '有点', '感觉', '我觉得', '这个', '稍微', '似乎']);

/* 否定词：出现在命中位置之前 2–3 字（英文 2 词）时，增量 × -0.6。
   打折反转而不是直接取反——"不烦了"的正向强度弱于"开心"。见设计 §5.6。 */
export const NEGATION_WORDS = Object.freeze(['不', '没', '别', '无', '非', '未', 'not', "n't", 'never', 'no']);
export const NEGATION_FACTOR = -0.6;

/* 人称词：判定「指向人」。命中词所在分句里出现即视为在说"你"。 */
export const PERSON_WORDS = Object.freeze(['你', '您', 'you']);

/* 分句边界：找"同一句"的起点时用 */
export const CLAUSE_BREAKS = Object.freeze(['。', '！', '？', '；', '，', '\n', '.', '!', '?', ';', ',']);

/**
 * 内置三维。
 *
 * words 用分组式写法（维度级「默认指向」+ 逐条例外），加载时展开成逐条。
 * 分组写法的好处：同一维度里 90% 的词指向一致，不必每行重复。
 */
export const BUILTIN_FIELDS = Object.freeze([
  Object.freeze({
    id: 'favor',
    label: '好感',
    builtin: true,
    baseline: 80,
    decayHalfLifeMin: 0,          // 0 = 视为不衰减（好感慢变，靠沉淀自然回归）
    defaultTarget: '人',
    words: Object.freeze({
      轻加: Object.freeze(['谢谢', '感谢', '谢啦', '多谢', '辛苦了', '不错', '可以啊', '还行', '稳', '乖', '好听',
        'thanks', 'thank you', 'thx', 'nice',
        '谢了', '多谢了', '辛苦啦', '有劳', '承让']),
      中加: Object.freeze(['厉害', '棒', '赞', '牛', '优秀', '佩服', '靠谱', '给力', '做得好', '专业', '满意', '真好',
        'great', 'awesome', 'perfect', 'well done', 'good job',
        '可靠', '贴心', '细心', '周到', '有心', '够意思']),
      重加: Object.freeze(['太好了', '完美', '太强', '绝了', 'amazing', 'excellent', 'brilliant', 'impressive', 'love it',
        '太贴心', '特别好', '无可挑剔']),
      轻减: Object.freeze(['有点失望', '不太行',
        '一般', '还行吧', '马马虎虎', '凑合', '冷淡', '爱答不理', '不上心', '应付']),
      中减: Object.freeze(['差劲', '太差', '敷衍', '失望', '还好意思', '离谱',
        '过分', '不靠谱', '自私', '小气', '冷漠', '随便吧']),
      重减: Object.freeze(['垃圾', '废物', '没用', '笨', '傻', '滚', '闭嘴', '蠢', '弱智', '什么玩意', '智障',
        '拉胯', '你行不行', 'stupid', 'useless', 'garbage', 'trash', 'dumb', 'idiot', 'nonsense', 'pathetic',
        '恶心', '滚蛋'])
    }),
    exceptions: Object.freeze([]),
    bands: Object.freeze([
      Object.freeze({ min: 80, text: '跟你越聊越投缘，语气亲近热络，想多说几句，也会主动搭话' }),
      Object.freeze({ min: 60, text: '相处自然，像熟朋友一样轻松接话，气氛融洽' }),
      Object.freeze({ min: 40, text: '关系平平，客气而克制，专注把当前的事聊清楚' }),
      Object.freeze({ min: 20, text: '有些疏远，语气淡淡的，回答直来直去，不再寒暄' }),
      Object.freeze({ min: 0, text: '关系降到冰点，公事公办，只给必要的话，不带一点热络' })
    ])
  }),

  Object.freeze({
    id: 'mood',
    label: '心情',
    builtin: true,
    baseline: 80,
    decayHalfLifeMin: 30,         // 一轮不顺，半小时淡掉
    defaultTarget: '事',
    words: Object.freeze({
      轻加: Object.freeze(['搞定', '成了', '舒服', '顺利', '行啊', '可以',
        '妥当', '办妥', '过关', '拿下', '稳住', '松口气',
        '顺畅', '搞定啦', '妥了', '稳了', '有戏', '松了口气', '顺当']),
      中加: Object.freeze(['漂亮', '终于', '太好了',
        '成功', '完美', '太棒了', '爽', '痛快',
        '开心', '高兴', '不错哦', '妙啊', '及时', '给力啊']),
      重加: Object.freeze(['太完美了',
        '太爽了', '喜出望外', '太走运了', '开心坏了']),
      轻减: Object.freeze(['烦', '无语', '麻烦',
        '心累', '头疼', '糟心', '卡住', '憋屈',
        '不爽', '别扭', '闹心', '堵心', '扫兴']),
      中减: Object.freeze(['难受', '崩了', '崩溃', '又炸', '气死', '烦死', '不行了', '看不下去',
        '浪费时间', '白干', '重做', '麻了', '太难了', '没成功', 'terrible', 'awful', 'disappointed',
        '白忙', '泡汤', '翻车',
        '憋屈啊', '受不了', '气人', '无语了', '折腾']),
      重减: Object.freeze(['烦死了', '彻底崩了', '完全没用',
        '气炸了', '受不了了',
        '气死我了', '要疯了', '崩溃了'])
    }),
    /* 例外：指向与维度默认值不同的词。
       · 两用词（不对/错了）→ 自动，靠"你"和缓和词判
       · 讨论类 → 讨论，认真交换意见不是负面事件
       · 生闷气类（随便你/算了）→ 自动，对事是收尾、对人是冷淡 */
    exceptions: Object.freeze([
      Object.freeze({ 词: '不对', 档位: '轻减', 指向: '自动' }),
      Object.freeze({ 词: '错了', 档位: '轻减', 指向: '自动' }),
      Object.freeze({ 词: '不行', 档位: '轻减', 指向: '自动' }),
      Object.freeze({ 词: 'wrong', 档位: '轻减', 指向: '自动' }),
      Object.freeze({ 词: '我不同意', 档位: '轻加', 指向: '讨论' }),
      Object.freeze({ 词: '换个思路', 档位: '轻加', 指向: '讨论' }),
      Object.freeze({ 词: '我觉得更好', 档位: '轻加', 指向: '讨论' }),
      Object.freeze({ 词: '要不试试', 档位: '轻加', 指向: '讨论' }),
      Object.freeze({ 词: '随便你', 档位: '轻减', 指向: '自动' }),
      Object.freeze({ 词: '不用了', 档位: '轻减', 指向: '自动' }),
      Object.freeze({ 词: '我自己来', 档位: '轻减', 指向: '自动' }),
      Object.freeze({ 词: '别管', 档位: '轻减', 指向: '自动' }),
      Object.freeze({ 词: '行了', 档位: '轻减', 指向: '自动' }),
      Object.freeze({ 词: '哦', 档位: '轻减', 指向: '自动' }),
      Object.freeze({ 词: '无所谓', 档位: '轻减', 指向: '自动' }),
      Object.freeze({ 词: '算了', 档位: '中减', 指向: '自动' })
    ]),
    bands: Object.freeze([
      Object.freeze({ min: 80, text: '心情很好，眉飞色舞，说话生动，愿意把事情多聊几句' }),
      Object.freeze({ min: 60, text: '心情平稳，语气放松自然，按部就班把事情做好' }),
      Object.freeze({ min: 40, text: '有点闷闷不乐，话变短了，先把手头的事应付过去' }),
      Object.freeze({ min: 20, text: '烦躁上头，语气又快又冲，只想赶紧把事情收尾' }),
      Object.freeze({ min: 0, text: '心情糟透了，强撑着说话，语气生硬但任务不会落下' })
    ])
  }),

  Object.freeze({
    id: 'energy',
    label: '精神',
    builtin: true,
    baseline: 80,
    decayHalfLifeMin: 120,        // 比心情慢：累是攒出来的，也不会半小时就恢复
    defaultTarget: '事',
    words: Object.freeze({
      轻加: Object.freeze(['睡好了', '歇过了', '休息了',
        '睡醒', '缓过来', '充电', '精神了', '有劲', '回血', '歇会儿']),
      中加: Object.freeze(['满血', '状态好', '精神抖擞', '活力满满', '劲头足', '生龙活虎']),
      重加: Object.freeze(['精力充沛', '满血复活']),
      轻减: Object.freeze(['累了', '困了', '乏了', '没劲',
        '困', '倦', '蔫了', '犯困', '打不起精神', '没睡好', '没精神']),
      中减: Object.freeze(['撑不住', '熬夜', '通宵', '卡死', '累死', '累死了', '疲惫',
        '疲劳', '乏力', '倦怠', '头昏', '撑不住了', '熬了一夜', '耗光了']),
      重减: Object.freeze(['精疲力尽', '彻底不行了', '熬不动了',
        '累趴了', '油尽灯枯', '扛不住了', '累瘫了'])
    }),
    exceptions: Object.freeze([]),
    bands: Object.freeze([
      Object.freeze({ min: 80, text: '神采奕奕，思路飞快，回答展开充分，把细节讲透' }),
      Object.freeze({ min: 60, text: '状态在线，从容不迫，该讲清楚的地方不省略' }),
      Object.freeze({ min: 40, text: '有些疲惫，回答抓重点，铺垫能省则省' }),
      Object.freeze({ min: 20, text: '困意上来了，言简意赅，只保留必要的步骤和结论' }),
      Object.freeze({ min: 0, text: '油尽灯枯，用最省力的方式交付任务，但不糊弄' })
    ])
  })
]);

/**
 * 把分组式词表展开成逐条形式。
 *
 * @param {object} field BUILTIN_FIELDS 的一项
 * @returns {Array<{词:string, 档位:string, 指向:string}>}
 */
export function expandWords(field) {
  const out = [];
  const words = field?.words ?? {};
  for (const [档位, list] of Object.entries(words)) {
    for (const 词 of list ?? []) {
      const w = String(词 ?? '').trim();
      if (w === '') continue;
      out.push({ 词: w, 档位, 指向: field.defaultTarget ?? '事' });
    }
  }
  for (const item of field?.exceptions ?? []) {
    const w = String(item?.词 ?? '').trim();
    if (w === '') continue;
    out.push({ 词: w, 档位: item.档位, 指向: item.指向 ?? '自动' });
  }
  return out;
}
