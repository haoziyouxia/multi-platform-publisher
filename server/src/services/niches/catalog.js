/**
 * 垂直赛道目录（受众向）
 * 与「热搜词」不同：这里固定人群/主题，用于稳定选题与二创口吻
 */

const NICHES = [
  {
    id: 'middle_aged_men',
    name: '中年男人',
    emoji: '🧔',
    description: '35–55 岁男性：事业压力、家庭责任、健康、理财、情绪与自我成长',
    audience: '中年男性（约 35–55 岁），上有老下有小，关注现实问题与可执行建议',
    tone: '真诚、克制、不贩卖焦虑；少鸡汤空话，多具体场景与行动建议',
    // 搜索用关键词（会轮询/组合）
    // 明确中文站点向关键词，避免搜到英文站
    keywords: [
      '中年男人 焦虑 知乎',
      '中年男性 健康 体检',
      '中年 职场 瓶颈 裁员',
      '中年男人 家庭 责任',
      '中年男人 理财 保险',
      '中年 婚姻 沟通 矛盾',
      '中年 啤酒肚 减脂',
      '中年危机 怎么办 中国',
      '中年男人 情绪 内耗',
      '中年 副业 赚钱 经验',
    ],
    // 二创选题方向提示
    angles: [
      '健康与体能（睡眠、体检、久坐、啤酒肚）',
      '职场与收入（中年裁员、技能更新、副业）',
      '家庭与婚姻（沟通、育儿、赡养父母）',
      '情绪与自我（孤独、意义感、朋友圈变少）',
      '消费与理财（保险、房贷、教育金）',
    ],
    default: true,
  },
  {
    id: 'middle_aged_women',
    name: '中年女性',
    emoji: '👩',
    description: '30–50 岁女性：事业家庭平衡、护肤抗衰、情绪价值、独立与成长',
    audience: '中年女性，关注形象管理、家庭关系与自我价值',
    tone: '温暖有力量，避免刻板印象与贩卖容貌焦虑',
    keywords: [
      '中年女性 焦虑',
      '中年女人 职场',
      '中年 护肤 抗衰',
      '中年女性 婚姻',
      '中年 独立女性',
    ],
    angles: ['事业家庭平衡', '健康抗衰', '情绪与边界', '理财独立'],
    default: false,
  },
  {
    id: 'workplace_growth',
    name: '职场成长',
    emoji: '💼',
    description: '打工人通用：晋升、沟通、裁员、副业、认知提升',
    audience: '在职白领与管理者',
    tone: '务实、案例化、可落地',
    keywords: [
      '职场 晋升',
      '中年 裁员 怎么办',
      '职场 沟通 技巧',
      '副业 赚钱 2024',
      '打工人 焦虑',
    ],
    angles: ['晋升路径', '向上管理', '裁员应对', '副业起步'],
    default: false,
  },
  {
    id: 'health_life',
    name: '健康生活',
    emoji: '🏃',
    description: '睡眠、运动、慢病预防、饮食——偏中年向科普',
    audience: '关注健康管理的中青年人群',
    tone: '科普严谨，不恐吓，不承诺疗效',
    keywords: [
      '中年 体检 指标',
      '久坐 危害 改善',
      '中年 睡眠 质量',
      '中年 减脂 方法',
      '高血压 年轻化',
    ],
    angles: ['体检解读', '运动起步', '睡眠改善', '饮食结构调整'],
    default: false,
  },
];

function listNiches() {
  return NICHES.map((n) => ({
    id: n.id,
    name: n.name,
    emoji: n.emoji,
    description: n.description,
    audience: n.audience,
    angles: n.angles,
    keyword_count: n.keywords.length,
    default: !!n.default,
  }));
}

function getNicheById(id) {
  return NICHES.find((n) => n.id === id) || null;
}

/**
 * 为一次搜索挑选查询词
 * @param {object} niche
 * @param {string} [userQuery] 用户自定义补充词
 */
function pickSearchQueries(niche, userQuery, count = 5) {
  const base = [...(niche.keywords || [])];
  // 打乱后取前 count 个，保证每次刷新略有变化
  for (let i = base.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  const picked = base.slice(0, count);
  if (userQuery && userQuery.trim()) {
    picked.unshift(`${niche.name} ${userQuery.trim()}`);
  }
  // 再加「真实经历 / 干货」向，减少广告词结果
  picked.push(`${niche.name} 真实经历 中国`);
  picked.push(`${niche.name} 经验分享 -加微信 -课程`);
  return [...new Set(picked)].slice(0, count + 2);
}

module.exports = {
  NICHES,
  listNiches,
  getNicheById,
  pickSearchQueries,
};
