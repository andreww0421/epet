import React, { useState, useEffect, useRef } from 'react';
import { 
  Dog, Cat, Bird, Rabbit, Turtle, Fish, Snail, Bug, Rat, Squirrel, PiggyBank, Worm, Ghost, Bot, PawPrint,
  Heart, Frown, Meh, Smile, Dumbbell, Download, Upload, Plus, Minus, Utensils, Users, Settings, AlertCircle, Trash2, Swords, Star, Shield, Zap, Trophy, X, ChevronsDown, Edit2, Save,
  Egg, Medal, Award, Crown, Sparkles, Gift, Dices, BarChart3, RefreshCw
} from 'lucide-react';

type Pet = {
  type: string;
  fullness: number;
  happiness: number;
  level: number;
};

type StudentStats = {
  wins: number;
  losses: number;
};

type Student = {
  id: string;
  name: string;
  points: number;
  pet: Pet;
  stats?: StudentStats;
  rankPoints?: number;
  badges?: string[];
};

type Language = 'zh' | 'en';

type ClassData = {
  id: string;
  name: string;
  students: Student[];
};

type AppData = {
  lastOpened: number;
  classes: ClassData[];
  currentClassId: string;
  settings?: {
    decayAmount: number;
    decayType: 'hourly' | 'daily';
    language?: Language;
    feedCost?: number;
  };
};

const translations = {
  zh: {
    appTitle: '班級寵物養成系統',
    classroom: '展示大廳',
    dashboard: '導師控制台',
    loading: '載入中...',
    addedStudent: '已新增學生：',
    deletedStudent: '已刪除學生：',
    petMaxLevel: '寵物已達最高等級！',
    fullnessNeed100: '飽食度必須達到 100 才能升級！',
    upgradeNeedPoints: '升級需要 {cost} 積分！',
    petUpgraded: '{name} 的寵物升級到等級 {level} 了！',
    levelDecreased: '已降低寵物等級',
    settingsSaved: '設定已儲存',
    fullnessNeed50Battle: '飽食度不足 50，無法對戰！',
    battleWon: '對戰勝利！獲得 50 積分',
    battleLost: '對戰失敗！扣除 60 積分',
    importSuccess: '資料匯入成功！',
    invalidData: '無效的資料格式',
    fileReadFailed: '檔案讀取失敗',
    dashboardDesc: '管理學生積分與系統資料，所有變更將自動儲存於瀏覽器中。',
    exportData: '匯出 JSON',
    importData: '匯入 JSON',
    addStudent: '新增學生',
    studentName: '學生姓名',
    enterName: '輸入姓名...',
    selectPet: '選擇寵物',
    add: '新增',
    petType: '寵物種類',
    level: '等級',
    availablePoints: '可用積分',
    petFullness: '寵物飽食度',
    actions: '操作',
    noStudents: '目前沒有學生資料，請在上方新增。',
    addPoints: '加分',
    deductPoints: '扣分',
    manualAdjust: '手動加減分',
    manual: '手動',
    decreaseLevel: '降低等級',
    deleteStudent: '刪除學生',
    systemSettings: '系統設定',
    decayFrequency: '飽食度扣除頻率',
    hourly: '每小時',
    daily: '每天',
    decayAmount: '扣除量',
    feedCost: '餵食所需積分',
    saveSettings: '儲存設定',
    manualAdjustTitle: '手動調整積分',
    manualAdjustDesc: '請輸入要為 {name} 調整的積分數量：',
    manualAdjustPlaceholder: '例如: 20',
    cancel: '取消',
    deduct: '扣除',
    increase: '增加',
    delete: '刪除',
    confirmDelete: '確定要刪除嗎？',
    deleteWarning: '刪除後將無法復原此學生（{name}）的資料與寵物狀態。',
    confirmDeleteBtn: '確定刪除',
    classroomTitle: '寵物展示大廳',
    classroomDesc: '看看大家的寵物過得好不好！記得用積分餵食牠們喔～',
    noPets: '目前沒有寵物',
    addStudentFirst: '請導師先到控制台新增學生！',
    selectOpponent: '選擇對戰對手',
    battleRules: '對戰將消耗 50 飽食度。勝利可獲得 50 積分，失敗將扣除 60 積分。',
    noOpponents: '沒有其他學生可以對戰。',
    startBattle: '開始對戰',
    statusHappy: '開心',
    statusHungry: '飢餓/虛弱',
    statusNormal: '普通',
    points: '積分',
    alreadyFull: '已經很飽了！',
    feedPet: '餵食 (-{cost} 積分)',
    notEnoughPoints: '積分不足',
    maxLevel: '滿級',
    upgradePet: '升級 (-{cost})',
    battle: '對戰',
    feedNeedPoints: '餵食需 {cost} 積分',
    battleNeedFullness: '對戰需 50 飽食度',
    upgradeNeedFullness: '升級需飽食度 100',
    language: '語言 / Language',
    classManagement: '班級管理',
    addClass: '新增班級',
    className: '班級名稱',
    enterClassName: '輸入班級名稱...',
    deleteClass: '刪除班級',
    confirmDeleteClass: '確定要刪除班級嗎？',
    deleteClassWarning: '刪除後將無法復原此班級（{name}）的所有學生資料。',
    classAdded: '已新增班級：',
    classDeleted: '已刪除班級：',
    gacha: '扭蛋 (-200)',
    gachaResult: '抽到了 {pet}！',
    leaderboard: '榮譽榜',
    rank: '段位',
    wins: '勝',
    losses: '敗',
    winRate: '勝率',
    bronze: '青銅',
    silver: '白銀',
    gold: '黃金',
    platinum: '白金',
    diamond: '鑽石',
    badgeFirstWin: '首勝',
    badgeRich: '大富翁',
    badgeMaxLevel: '滿級大師',
    badgeVeteran: '百戰天龍',
    rankPoints: '段位分',
    resetSeason: '重置賽季',
  },
  en: {
    appTitle: 'Classroom Pet System',
    classroom: 'Classroom',
    dashboard: 'Teacher Console',
    loading: 'Loading...',
    addedStudent: 'Added student: ',
    deletedStudent: 'Deleted student: ',
    petMaxLevel: 'Pet has reached the max level!',
    fullnessNeed100: 'Fullness must be 100 to upgrade!',
    upgradeNeedPoints: 'Upgrade requires {cost} points!',
    petUpgraded: "{name}'s pet upgraded to level {level}!",
    levelDecreased: 'Pet level decreased',
    settingsSaved: 'Settings saved',
    fullnessNeed50Battle: 'Fullness below 50, cannot battle!',
    battleWon: 'Battle won! Gained 50 points',
    battleLost: 'Battle lost! Deducted 60 points',
    importSuccess: 'Data imported successfully!',
    invalidData: 'Invalid data format',
    fileReadFailed: 'File read failed',
    dashboardDesc: 'Manage student points and system data. All changes are saved automatically.',
    exportData: 'Export JSON',
    importData: 'Import JSON',
    addStudent: 'Add Student',
    studentName: 'Student Name',
    enterName: 'Enter name...',
    selectPet: 'Select Pet',
    add: 'Add',
    petType: 'Pet Type',
    level: 'Level',
    availablePoints: 'Available Points',
    petFullness: 'Pet Fullness',
    actions: 'Actions',
    noStudents: 'No student data. Please add above.',
    addPoints: 'Add Points',
    deductPoints: 'Deduct Points',
    manualAdjust: 'Manual Adjust',
    manual: 'Manual',
    decreaseLevel: 'Decrease Level',
    deleteStudent: 'Delete Student',
    systemSettings: 'System Settings',
    decayFrequency: 'Fullness Decay Frequency',
    hourly: 'Hourly',
    daily: 'Daily',
    decayAmount: 'Decay Amount',
    feedCost: 'Feeding Cost (Points)',
    saveSettings: 'Save Settings',
    manualAdjustTitle: 'Manual Points Adjustment',
    manualAdjustDesc: 'Enter points to adjust for {name}:',
    manualAdjustPlaceholder: 'e.g., 20',
    cancel: 'Cancel',
    deduct: 'Deduct',
    increase: 'Add',
    delete: 'Delete',
    confirmDelete: 'Are you sure?',
    deleteWarning: 'Once deleted, the data and pet status of ({name}) cannot be recovered.',
    confirmDeleteBtn: 'Confirm Delete',
    classroomTitle: 'Pet Exhibition Hall',
    classroomDesc: 'See how everyone\'s pets are doing! Remember to feed them with points~',
    noPets: 'No pets currently',
    addStudentFirst: 'Please ask the teacher to add students in the console first!',
    selectOpponent: 'Select Opponent',
    battleRules: 'Battling costs 50 fullness. Victory grants 50 points, defeat deducts 60 points.',
    noOpponents: 'No other students available to battle.',
    startBattle: 'Start Battle',
    statusHappy: 'Happy',
    statusHungry: 'Hungry/Weak',
    statusNormal: 'Normal',
    points: 'Points',
    alreadyFull: 'Already full!',
    feedPet: 'Feed (-{cost} pts)',
    notEnoughPoints: 'Not enough pts',
    maxLevel: 'Max Lv',
    upgradePet: 'Upgrade (-{cost})',
    battle: 'Battle',
    feedNeedPoints: 'Feeding requires {cost} pts',
    battleNeedFullness: 'Battling requires 50 fullness',
    upgradeNeedFullness: 'Upgrade requires 100 fullness',
    language: 'Language',
    classManagement: 'Class Management',
    addClass: 'Add Class',
    className: 'Class Name',
    enterClassName: 'Enter class name...',
    deleteClass: 'Delete Class',
    confirmDeleteClass: 'Delete Class?',
    deleteClassWarning: 'Once deleted, all student data in this class ({name}) cannot be recovered.',
    classAdded: 'Added class: ',
    classDeleted: 'Deleted class: ',
    gacha: 'Gacha (-200)',
    gachaResult: 'Got {pet}!',
    leaderboard: 'Leaderboard',
    rank: 'Rank',
    wins: 'W',
    losses: 'L',
    winRate: 'Win Rate',
    bronze: 'Bronze',
    silver: 'Silver',
    gold: 'Gold',
    platinum: 'Platinum',
    diamond: 'Diamond',
    badgeFirstWin: 'First Win',
    badgeRich: 'Rich',
    badgeMaxLevel: 'Max Level',
    badgeVeteran: 'Veteran',
    rankPoints: 'RP',
    resetSeason: 'Reset Season',
  }
};

const petNames = {
  zh: {
    egg: '神秘寵物蛋',
    dog: '狗狗', cat: '貓咪', bird: '小鳥', rabbit: '兔子', turtle: '烏龜',
    fish: '魚', snail: '蝸牛', bug: '甲蟲', rat: '老鼠', squirrel: '松鼠',
    piggybank: '小豬', worm: '毛毛蟲', ghost: '幽靈', bot: '機器人', pawprint: '熊熊'
  },
  en: {
    egg: 'Mystery Egg',
    dog: 'Dog', cat: 'Cat', bird: 'Bird', rabbit: 'Rabbit', turtle: 'Turtle',
    fish: 'Fish', snail: 'Snail', bug: 'Bug', rat: 'Rat', squirrel: 'Squirrel',
    piggybank: 'Piggy', worm: 'Worm', ghost: 'Ghost', bot: 'Bot', pawprint: 'Bear'
  }
};

const PET_TYPES = [
  { id: 'egg', icon: Egg, rarity: 'common' },
  { id: 'dog', icon: Dog, rarity: 'common' },
  { id: 'cat', icon: Cat, rarity: 'common' },
  { id: 'bird', icon: Bird, rarity: 'common' },
  { id: 'rabbit', icon: Rabbit, rarity: 'common' },
  { id: 'turtle', icon: Turtle, rarity: 'common' },
  { id: 'fish', icon: Fish, rarity: 'common' },
  { id: 'snail', icon: Snail, rarity: 'common' },
  { id: 'bug', icon: Bug, rarity: 'common' },
  { id: 'rat', icon: Rat, rarity: 'common' },
  { id: 'worm', icon: Worm, rarity: 'common' },
  { id: 'squirrel', icon: Squirrel, rarity: 'rare' },
  { id: 'piggybank', icon: PiggyBank, rarity: 'rare' },
  { id: 'pawprint', icon: PawPrint, rarity: 'rare' },
  { id: 'ghost', icon: Ghost, rarity: 'legendary' },
  { id: 'bot', icon: Bot, rarity: 'legendary' },
];

const DEFAULT_CLASS_NAME = '預設班級';
const STORAGE_KEY = 'tamagotchi_classroom_data';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const toFiniteNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const computeBadges = (student: Pick<Student, 'points' | 'pet' | 'stats'>) => {
  const badges = new Set<string>();

  if ((student.stats?.wins || 0) >= 1) badges.add('badgeFirstWin');
  if ((student.stats?.wins || 0) >= 10) badges.add('badgeVeteran');
  if (student.points >= 500) badges.add('badgeRich');
  if ((student.pet.level || 1) >= 10) badges.add('badgeMaxLevel');

  return Array.from(badges);
};

const createInitialData = (now = Date.now()): AppData => ({
  lastOpened: now,
  classes: [
    {
      id: 'default',
      name: DEFAULT_CLASS_NAME,
      students: [],
    },
  ],
  currentClassId: 'default',
  settings: {
    decayAmount: 2,
    decayType: 'hourly',
    language: 'zh',
    feedCost: 10,
  },
});

const normalizeStudent = (student: any, fallbackIndex: number): Student => {
  const normalizedStudent: Student = {
    id: typeof student?.id === 'string' && student.id ? student.id : `student-${Date.now()}-${fallbackIndex}`,
    name: typeof student?.name === 'string' && student.name.trim() ? student.name.trim() : `Student ${fallbackIndex + 1}`,
    points: clamp(toFiniteNumber(student?.points, 0), 0, 700),
    pet: {
      type: PET_TYPES.some((pet) => pet.id === student?.pet?.type) ? student.pet.type : 'egg',
      fullness: clamp(toFiniteNumber(student?.pet?.fullness, 80), 0, 100),
      happiness: clamp(toFiniteNumber(student?.pet?.happiness, 80), 0, 100),
      level: clamp(Math.floor(toFiniteNumber(student?.pet?.level, 1)), 1, 10),
    },
    stats: {
      wins: Math.max(0, Math.floor(toFiniteNumber(student?.stats?.wins, 0))),
      losses: Math.max(0, Math.floor(toFiniteNumber(student?.stats?.losses, 0))),
    },
    rankPoints: Math.max(0, Math.floor(toFiniteNumber(student?.rankPoints, 1000))),
    badges: [],
  };

  return {
    ...normalizedStudent,
    badges: computeBadges(normalizedStudent),
  };
};

const normalizeAppData = (raw: any, now = Date.now()): AppData => {
  const initialData = createInitialData(now);
  const rawSettings = raw?.settings ?? {};
  const rawClasses = Array.isArray(raw?.classes) && raw.classes.length > 0
    ? raw.classes
    : [
        {
          id: 'default',
          name: DEFAULT_CLASS_NAME,
          students: Array.isArray(raw?.students) ? raw.students : [],
        },
      ];

  const classes = rawClasses.map((classItem: any, index: number) => ({
    id: typeof classItem?.id === 'string' && classItem.id ? classItem.id : `class-${Date.now()}-${index}`,
    name: typeof classItem?.name === 'string' && classItem.name.trim() ? classItem.name.trim() : DEFAULT_CLASS_NAME,
    students: Array.isArray(classItem?.students)
      ? classItem.students.map((student: any, studentIndex: number) => normalizeStudent(student, studentIndex))
      : [],
  }));

  const currentClassId = typeof raw?.currentClassId === 'string' && classes.some((classData) => classData.id === raw.currentClassId)
    ? raw.currentClassId
    : classes[0]?.id ?? initialData.currentClassId;

  return {
    lastOpened: toFiniteNumber(raw?.lastOpened, now),
    classes,
    currentClassId,
    settings: {
      decayAmount: Math.max(0, toFiniteNumber(rawSettings?.decayAmount ?? rawSettings?.hourlyDecay, initialData.settings?.decayAmount ?? 2)),
      decayType: rawSettings?.decayType === 'daily' ? 'daily' : 'hourly',
      language: rawSettings?.language === 'en' ? 'en' : 'zh',
      feedCost: Math.max(1, toFiniteNumber(rawSettings?.feedCost, initialData.settings?.feedCost ?? 10)),
    },
  };
};

const applyDecay = (appData: AppData, now = Date.now()): AppData => {
  const lastOpened = toFiniteNumber(appData.lastOpened, now);
  const elapsedMs = Math.max(0, now - lastOpened);
  const intervalMs = appData.settings?.decayType === 'daily' ? 1000 * 60 * 60 * 24 : 1000 * 60 * 60;
  const periodsPassed = Math.floor(elapsedMs / intervalMs);

  if (periodsPassed <= 0) {
    return appData;
  }

  const decay = periodsPassed * (appData.settings?.decayAmount ?? 2);
  const nextLastOpened = now - (elapsedMs % intervalMs);

  return {
    ...appData,
    lastOpened: nextLastOpened,
    classes: appData.classes.map((classData) => ({
      ...classData,
      students: classData.students.map((student) => ({
        ...student,
        pet: {
          ...student.pet,
          fullness: clamp(student.pet.fullness - decay, 0, 100),
        },
      })),
    })),
  };
};

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [view, setView] = useState<'dashboard' | 'classroom'>('classroom');
  const [animatingPets, setAnimatingPets] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error'} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const lang = data?.settings?.language || 'zh';
  const tLang = translations[lang];

  useEffect(() => {
    const loadData = () => {
      const stored = localStorage.getItem(STORAGE_KEY);
      const now = Date.now();
      
      if (stored) {
        try {
          const parsedData = JSON.parse(stored);
          const normalizedData = normalizeAppData(parsedData, now);
          const hydratedData = applyDecay(normalizedData, now);

          setData(hydratedData);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(hydratedData));
        } catch (e) {
          console.error("Failed to parse stored data", e);
          const initialData = createInitialData(now);
          setData(initialData);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(initialData));
        }
      } else {
        const initialData = createInitialData(now);
        setData(initialData);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(initialData));
      }
    };

    loadData();
  }, []);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const saveData = (newData: AppData) => {
    setData(newData);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
  };

  const evaluateBadges = (student: Student) => {
    return computeBadges(student);
  };

  const updateCurrentClassStudents = (newStudents: Student[]) => {
    if (!data) return;
    const evaluatedStudents = newStudents.map(s => ({ ...s, badges: evaluateBadges(s) }));
    const newClasses = data.classes.map(c => 
      c.id === data.currentClassId ? { ...c, students: evaluatedStudents } : c
    );
    saveData({ ...data, classes: newClasses });
  };

  const switchClass = (classId: string) => {
    if (!data) return;
    saveData({ ...data, currentClassId: classId });
  };

  const addClass = (name: string) => {
    if (!data) return;
    const newClass = { id: Date.now().toString(), name, students: [] };
    saveData({ ...data, classes: [...data.classes, newClass], currentClassId: newClass.id });
    showToast(`${tLang.classAdded}${name}`);
  };

  const deleteClass = (classId: string) => {
    if (!data || data.classes.length <= 1) return;
    const className = data.classes.find(c => c.id === classId)?.name;
    const newClasses = data.classes.filter(c => c.id !== classId);
    saveData({ 
      ...data, 
      classes: newClasses,
      currentClassId: data.currentClassId === classId ? newClasses[0].id : data.currentClassId
    });
    showToast(`${tLang.classDeleted}${className}`);
  };

  const addPoints = (studentId: string, pointsToAdd: number) => {
    if (!data) return;
    const currentClass = data.classes.find(c => c.id === data.currentClassId);
    if (!currentClass) return;
    updateCurrentClassStudents(currentClass.students.map(s => 
      s.id === studentId ? { ...s, points: Math.min(700, Math.max(0, s.points + pointsToAdd)) } : s
    ));
  };

  const addStudent = (student: Student) => {
    if (!data) return;
    const currentClass = data.classes.find(c => c.id === data.currentClassId);
    if (!currentClass) return;
    
    // Ensure new students start with 200 points and an egg if they don't have a specific pet
    const newStudent = {
      ...student,
      points: 200,
      pet: {
        ...student.pet,
        type: 'egg'
      },
      stats: { wins: 0, losses: 0 },
      rankPoints: 1000,
      badges: []
    };
    
    updateCurrentClassStudents([...currentClass.students, newStudent]);
    showToast(`${tLang.addedStudent}${student.name}`);
  };

  const deleteStudent = (studentId: string) => {
    if (!data) return;
    const currentClass = data.classes.find(c => c.id === data.currentClassId);
    if (!currentClass) return;
    const studentName = currentClass.students.find(s => s.id === studentId)?.name;
    updateCurrentClassStudents(currentClass.students.filter(s => s.id !== studentId));
    showToast(`${tLang.deletedStudent}${studentName}`);
  };

  const resetSeason = () => {
    if (!data) return;
    const currentClass = data.classes.find(c => c.id === data.currentClassId);
    if (!currentClass) return;
    
    updateCurrentClassStudents(currentClass.students.map(s => ({
      ...s,
      stats: { wins: 0, losses: 0 },
      rankPoints: 1000
    })));
    showToast(tLang.resetSeason);
  };

  const gachaPet = (studentId: string) => {
    if (!data) return;
    const currentClass = data.classes.find(c => c.id === data.currentClassId);
    if (!currentClass) return;
    
    const student = currentClass.students.find(s => s.id === studentId);
    if (!student || student.points < 200) return;

    const rand = Math.random();
    let rarity = 'common';
    if (rand > 0.9) rarity = 'legendary';
    else if (rand > 0.6) rarity = 'rare';

    const possiblePets = PET_TYPES.filter(p => p.rarity === rarity && p.id !== 'egg');
    const newPetType = possiblePets[Math.floor(Math.random() * possiblePets.length)].id;

    // Trigger animation
    setAnimatingPets(prev => ({ ...prev, [studentId]: true }));
    setTimeout(() => {
      setAnimatingPets(prev => ({ ...prev, [studentId]: false }));
    }, 1500);

    updateCurrentClassStudents(currentClass.students.map(s => {
      if (s.id === studentId) {
        return {
          ...s,
          points: s.points - 200,
          pet: {
            ...s.pet,
            type: newPetType
          }
        };
      }
      return s;
    }));
    
    showToast(tLang.gachaResult.replace('{pet}', (petNames[data.settings?.language || 'zh'] as any)[newPetType]), 'success');
  };

  const feedPet = (studentId: string) => {
    if (!data) return;
    const currentClass = data.classes.find(c => c.id === data.currentClassId);
    if (!currentClass) return;
    
    const feedCost = data.settings?.feedCost ?? 10;
    
    // Trigger animation
    setAnimatingPets(prev => ({ ...prev, [studentId]: true }));
    setTimeout(() => {
      setAnimatingPets(prev => ({ ...prev, [studentId]: false }));
    }, 1000);

    updateCurrentClassStudents(currentClass.students.map(s => {
      if (s.id === studentId && s.points >= feedCost) {
        return {
          ...s,
          points: s.points - feedCost,
          pet: {
            ...s.pet,
            fullness: Math.min(100, s.pet.fullness + 20)
          }
        };
      }
      return s;
    }));
  };

  const upgradePet = (studentId: string) => {
    if (!data) return;
    const currentClass = data.classes.find(c => c.id === data.currentClassId);
    if (!currentClass) return;
    const student = currentClass.students.find(s => s.id === studentId);
    if (!student) return;
    
    const currentLevel = student.pet.level || 1;
    if (currentLevel >= 10) {
        showToast(tLang.petMaxLevel, 'error');
        return;
    }
    if (student.pet.fullness < 100) {
        showToast(tLang.fullnessNeed100, 'error');
        return;
    }
    
    const upgradeCost = 100 + (currentLevel - 1) * 50;
    if (student.points < upgradeCost) {
        showToast(tLang.upgradeNeedPoints.replace('{cost}', upgradeCost.toString()), 'error');
        return;
    }
    
    updateCurrentClassStudents(currentClass.students.map(s => {
      if (s.id === studentId) {
        return {
          ...s,
          points: s.points - upgradeCost,
          pet: {
            ...s.pet,
            level: currentLevel + 1
          }
        };
      }
      return s;
    }));
    showToast(tLang.petUpgraded.replace('{name}', student.name).replace('{level}', (currentLevel + 1).toString()), 'success');
  };

  const decreaseLevel = (studentId: string) => {
    if (!data) return;
    const currentClass = data.classes.find(c => c.id === data.currentClassId);
    if (!currentClass) return;
    updateCurrentClassStudents(currentClass.students.map(s => {
      if (s.id === studentId && (s.pet.level || 1) > 1) {
        return {
          ...s,
          pet: {
            ...s.pet,
            level: (s.pet.level || 1) - 1
          }
        };
      }
      return s;
    }));
    showToast(tLang.levelDecreased, 'success');
  };

  const updateSettings = (decayAmount: number, decayType: 'hourly' | 'daily', language: Language, feedCost: number) => {
    if (!data) return;
    const safeDecayAmount = Math.max(0, Number.isFinite(decayAmount) ? decayAmount : 2);
    const safeFeedCost = Math.max(1, Number.isFinite(feedCost) ? feedCost : 10);
    const newData = {
      ...data,
      settings: {
        ...data.settings,
        decayAmount: safeDecayAmount,
        decayType,
        language,
        feedCost: safeFeedCost
      }
    };
    saveData(newData);
    showToast(tLang.settingsSaved, 'success');
  };

  const battle = (attackerId: string, defenderId: string) => {
    if (!data) return;
    const currentClass = data.classes.find(c => c.id === data.currentClassId);
    if (!currentClass) return;
    const attacker = currentClass.students.find(s => s.id === attackerId);
    const defender = currentClass.students.find(s => s.id === defenderId);
    
    if (!attacker || !defender) return;
    
    if (attacker.pet.fullness < 50) {
        showToast(tLang.fullnessNeed50Battle, 'error');
        return;
    }
    
    // Calculate battle score
    const attackerScore = (attacker.pet.level || 1) * 10 + attacker.pet.fullness + Math.floor(Math.random() * 20);
    const defenderScore = (defender.pet.level || 1) * 10 + defender.pet.fullness + Math.floor(Math.random() * 20);
    
    const isWin = attackerScore >= defenderScore;
    
    updateCurrentClassStudents(currentClass.students.map(s => {
      if (s.id === attackerId) {
          const stats = s.stats || { wins: 0, losses: 0 };
          const rankPoints = s.rankPoints || 0;
          return {
              ...s,
              points: Math.min(700, Math.max(0, s.points + (isWin ? 50 : -60))),
              pet: {
                  ...s.pet,
                  fullness: Math.max(0, s.pet.fullness - 50)
              },
              stats: {
                  wins: isWin ? stats.wins + 1 : stats.wins,
                  losses: isWin ? stats.losses : stats.losses + 1
              },
              rankPoints: isWin ? rankPoints + 20 : Math.max(0, rankPoints - 10)
          };
      }
      if (s.id === defenderId) {
          const stats = s.stats || { wins: 0, losses: 0 };
          const rankPoints = s.rankPoints || 0;
          return {
              ...s,
              points: Math.min(700, Math.max(0, s.points + (isWin ? -50 : 20))),
              pet: {
                  ...s.pet,
                  fullness: Math.max(0, s.pet.fullness - (isWin ? 50 : 10))
              },
              stats: {
                  wins: !isWin ? stats.wins + 1 : stats.wins,
                  losses: !isWin ? stats.losses : stats.losses + 1
              },
              rankPoints: !isWin ? rankPoints + 20 : Math.max(0, rankPoints - 10)
          };
      }
      return s;
    }));
    
    if (isWin) {
        showToast(tLang.battleWon, 'success');
    } else {
        showToast(tLang.battleLost, 'error');
    }
  };

  const exportData = () => {
    if (!data) return;
    const dataStr = JSON.stringify(data, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `tamagotchi_classroom_${new Date().toISOString().slice(0,10)}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const importData = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedData = JSON.parse(e.target?.result as string);
        const hasSupportedShape = Array.isArray(importedData?.classes) || Array.isArray(importedData?.students);

        if (hasSupportedShape) {
          const normalizedData = normalizeAppData(importedData, Date.now());
          saveData({ ...normalizedData, lastOpened: Date.now() });
          showToast(tLang.importSuccess, 'success');
        } else {
          showToast(tLang.invalidData, 'error');
        }
      } catch (error) {
        showToast(tLang.invalidData, 'error');
      }
    };
    reader.onerror = () => {
      showToast(tLang.fileReadFailed, 'error');
    };
    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (!data) return <div className="flex h-screen items-center justify-center bg-gray-50 text-gray-500">{tLang.loading}</div>;

  return (
    <div className="min-h-screen flex flex-col font-sans">
      {/* Navbar */}
      <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Dog className="h-8 w-8 text-indigo-600 mr-3" />
              <span className="font-bold text-xl text-gray-900">{tLang.appTitle}</span>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setView('classroom')}
                className={`flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  view === 'classroom' 
                    ? 'bg-amber-100 text-amber-800' 
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Users className="h-4 w-4 mr-2" />
                {tLang.classroom}
              </button>
              <button
                onClick={() => setView('dashboard')}
                className={`flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  view === 'dashboard' 
                    ? 'bg-indigo-100 text-indigo-800' 
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Settings className="h-4 w-4 mr-2" />
                {tLang.dashboard}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {view === 'dashboard' ? (
          <DashboardView 
            data={data} 
            addPoints={addPoints} 
            addStudent={addStudent}
            deleteStudent={deleteStudent}
            exportData={exportData} 
            importData={importData}
            fileInputRef={fileInputRef}
            decreaseLevel={decreaseLevel}
            updateSettings={updateSettings}
            switchClass={switchClass}
            addClass={addClass}
            deleteClass={deleteClass}
            resetSeason={resetSeason}
            lang={lang}
            tLang={tLang}
          />
        ) : (
          <ClassroomView 
            data={data} 
            feedPet={feedPet} 
            upgradePet={upgradePet}
            battle={battle}
            gachaPet={gachaPet}
            animatingPets={animatingPets} 
            lang={lang}
            tLang={tLang}
          />
        )}
      </main>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-[bounce_0.5s_ease-in-out]">
          <div className={`px-4 py-3 rounded-lg shadow-lg flex items-center ${
            toast.type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-red-100 text-red-800 border border-red-200'
          }`}>
            {toast.type === 'success' ? <Smile className="h-5 w-5 mr-2" /> : <AlertCircle className="h-5 w-5 mr-2" />}
            <span className="font-medium">{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Dashboard View Component ---
function DashboardView({ data, addPoints, addStudent, deleteStudent, exportData, importData, fileInputRef, decreaseLevel, updateSettings, switchClass, addClass, deleteClass, resetSeason, lang, tLang }: any) {
  const [newStudentName, setNewStudentName] = useState('');
  const [studentToDelete, setStudentToDelete] = useState<string | null>(null);
  const [customPoints, setCustomPoints] = useState<{id: string, name: string} | null>(null);
  const [pointsAmount, setPointsAmount] = useState('');
  const [decayAmount, setDecayAmount] = useState(data.settings?.decayAmount ?? data.settings?.hourlyDecay ?? 2);
  const [decayType, setDecayType] = useState<'hourly' | 'daily'>(data.settings?.decayType ?? 'hourly');
  const [feedCost, setFeedCost] = useState(data.settings?.feedCost ?? 10);
  const [currentLang, setCurrentLang] = useState<Language>(lang);
  
  const [newClassName, setNewClassName] = useState('');
  const [showAddClass, setShowAddClass] = useState(false);
  const [classToDelete, setClassToDelete] = useState<string | null>(null);

  const handleSaveSettings = () => {
    updateSettings(Number(decayAmount), decayType, currentLang, Number(feedCost));
  };

  const handleAddClass = () => {
    if (!newClassName.trim()) return;
    addClass(newClassName.trim());
    setNewClassName('');
    setShowAddClass(false);
  };

  const handleAddStudent = () => {
    if (!newStudentName.trim()) return;
    const newStudent: Student = {
      id: Date.now().toString(),
      name: newStudentName.trim(),
      points: 0,
      pet: {
        type: 'egg',
        fullness: 80,
        happiness: 80,
        level: 1
      },
      stats: { wins: 0, losses: 0 },
      rankPoints: 1000,
      badges: []
    };
    addStudent(newStudent);
    setNewStudentName('');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 bg-slate-50 min-h-full">
      <div className="sm:flex sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{tLang.dashboard}</h1>
          <p className="mt-2 text-sm text-slate-600">{tLang.dashboardDesc}</p>
        </div>
        <div className="mt-4 sm:mt-0 flex space-x-3">
          <button
            onClick={exportData}
            className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
          >
            <Download className="h-4 w-4 mr-2" />
            {tLang.exportData}
          </button>
          <input 
            type="file" 
            accept=".json" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={importData} 
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
          >
            <Upload className="h-4 w-4 mr-2" />
            {tLang.importData}
          </button>
        </div>
      </div>

      {/* Class Management */}
      <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200 mb-6 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex-1 w-full sm:max-w-xs">
            <label htmlFor="classSelect" className="block text-sm font-medium text-slate-700 mb-1">{tLang.classManagement}</label>
            <select
              id="classSelect"
              value={data.currentClassId}
              onChange={(e) => switchClass(e.target.value)}
              className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
            >
              {data.classes.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex space-x-3 mt-4 sm:mt-0 items-end">
            <button
              onClick={() => setShowAddClass(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
            >
              <Plus className="h-4 w-4 mr-2" />
              {tLang.addClass}
            </button>
            <button
              onClick={() => {
                if (window.confirm(tLang.resetSeason + '?')) {
                  resetSeason();
                }
              }}
              className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-amber-600 bg-white hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 transition-colors"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {tLang.resetSeason}
            </button>
            <button
              onClick={() => setClassToDelete(data.currentClassId)}
              disabled={data.classes.length <= 1}
              className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-red-600 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {tLang.deleteClass}
            </button>
          </div>
        </div>
      </div>

      {/* Add Student Form */}
      <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200 mb-6 p-5">
        <h3 className="text-lg font-medium text-slate-900 mb-4 flex items-center">
          <Users className="h-5 w-5 mr-2 text-indigo-500" />
          {tLang.addStudent}
        </h3>
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label htmlFor="studentName" className="block text-sm font-medium text-slate-700 mb-1">{tLang.studentName}</label>
            <input 
              type="text" 
              id="studentName"
              value={newStudentName}
              onChange={(e) => setNewStudentName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddStudent()}
              className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              placeholder={tLang.enterName}
            />
          </div>
          <button
            onClick={handleAddStudent}
            disabled={!newStudentName.trim()}
            className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-300 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="h-4 w-4 mr-2" />
            {tLang.add}
          </button>
        </div>
      </div>

      {/* Students Table */}
      <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.studentName}</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.petType}</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.level}</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.points}</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.petFullness}</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">{tLang.actions}</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {data.classes.find((c: any) => c.id === data.currentClassId)?.students.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                    {tLang.noStudents}
                  </td>
                </tr>
              ) : (
                data.classes.find((c: any) => c.id === data.currentClassId)?.students.map((student: any) => {
                  const petConfig = PET_TYPES.find(p => p.id === student.pet.type) || PET_TYPES[0];
                  const PetIcon = petConfig.icon;
                  
                  return (
                    <tr key={student.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-slate-900">{student.name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm text-slate-600">
                          <PetIcon className="h-4 w-4 mr-2 text-slate-400" />
                          {petNames[lang][petConfig.id as keyof typeof petNames['zh']]}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-bold text-amber-600">Lv. {student.pet.level || 1}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-bold text-indigo-600">{student.points} / 700</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="w-full bg-slate-200 rounded-full h-2.5 mr-2 max-w-[100px]">
                            <div 
                              className={`h-2.5 rounded-full ${
                                student.pet.fullness > 70 ? 'bg-green-500' : 
                                student.pet.fullness >= 30 ? 'bg-yellow-400' : 'bg-red-500'
                              }`} 
                              style={{ width: `${student.pet.fullness}%` }}
                            ></div>
                          </div>
                          <span className="text-sm text-slate-600">{student.pet.fullness}/100</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end items-center space-x-3">
                          {/* Add Points */}
                          <div className="flex space-x-1 bg-indigo-50 p-1 rounded-md border border-indigo-100">
                            <button
                              onClick={() => addPoints(student.id, 10)}
                              className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-indigo-700 hover:bg-indigo-200 transition-colors"
                              title={tLang.addPoints}
                            >
                              <Plus className="h-3 w-3" /> 10
                            </button>
                            <button
                              onClick={() => addPoints(student.id, 50)}
                              className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-indigo-700 hover:bg-indigo-200 transition-colors"
                              title={tLang.addPoints}
                            >
                              <Plus className="h-3 w-3" /> 50
                            </button>
                          </div>
                          
                          {/* Deduct Points */}
                          <div className="flex space-x-1 bg-rose-50 p-1 rounded-md border border-rose-100">
                            <button
                              onClick={() => addPoints(student.id, -10)}
                              disabled={student.points < 10}
                              className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-rose-700 hover:bg-rose-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              title={tLang.deductPoints}
                            >
                              <Minus className="h-3 w-3" /> 10
                            </button>
                            <button
                              onClick={() => addPoints(student.id, -50)}
                              disabled={student.points < 50}
                              className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-rose-700 hover:bg-rose-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              title={tLang.deductPoints}
                            >
                              <Minus className="h-3 w-3" /> 50
                            </button>
                            <button
                              onClick={() => setCustomPoints({id: student.id, name: student.name})}
                              className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-indigo-700 hover:bg-indigo-200 transition-colors"
                              title={tLang.manualAdjust}
                            >
                              <Edit2 className="h-3 w-3" /> {tLang.manual}
                            </button>
                          </div>

                          {/* Decrease Level */}
                          <button
                            onClick={() => decreaseLevel(student.id)}
                            disabled={(student.pet.level || 1) <= 1}
                            className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title={tLang.decreaseLevel}
                          >
                            <ChevronsDown className="h-4 w-4" />
                          </button>

                          {/* Delete */}
                          <button
                            onClick={() => setStudentToDelete(student.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                            title={tLang.deleteStudent}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* System Settings */}
      <div className="bg-white shadow-sm rounded-lg overflow-hidden border border-slate-200 mt-6 p-5">
        <h3 className="text-lg font-medium text-slate-900 mb-4 flex items-center">
          <Settings className="h-5 w-5 mr-2 text-indigo-500" />
          {tLang.systemSettings}
        </h3>
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label htmlFor="language" className="block text-sm font-medium text-slate-700 mb-1">{tLang.language}</label>
            <select
              id="language"
              value={currentLang}
              onChange={(e) => setCurrentLang(e.target.value as Language)}
              className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="flex-1 w-full">
            <label htmlFor="decayType" className="block text-sm font-medium text-slate-700 mb-1">{tLang.decayFrequency}</label>
            <select
              id="decayType"
              value={decayType}
              onChange={(e) => setDecayType(e.target.value as 'hourly' | 'daily')}
              className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
            >
              <option value="hourly">{tLang.hourly}</option>
              <option value="daily">{tLang.daily}</option>
            </select>
          </div>
          <div className="flex-1 w-full">
            <label htmlFor="decayAmount" className="block text-sm font-medium text-slate-700 mb-1">{tLang.decayAmount}</label>
            <input 
              type="number" 
              id="decayAmount"
              min="0"
              value={decayAmount}
              onChange={(e) => setDecayAmount(Number(e.target.value))}
              className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
            />
          </div>
          <div className="flex-1 w-full">
            <label htmlFor="feedCost" className="block text-sm font-medium text-slate-700 mb-1">{tLang.feedCost}</label>
            <input 
              type="number" 
              id="feedCost"
              min="1"
              value={feedCost}
              onChange={(e) => setFeedCost(Number(e.target.value))}
              className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
            />
          </div>
          <button
            onClick={handleSaveSettings}
            className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
          >
            <Save className="h-4 w-4 mr-2" />
            {tLang.saveSettings}
          </button>
        </div>
      </div>

      {/* Add Class Modal */}
      {showAddClass && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full overflow-hidden">
            <div className="p-6">
              <h3 className="text-lg font-bold text-slate-900 mb-4">{tLang.addClass}</h3>
              <div className="mb-4">
                <label htmlFor="className" className="block text-sm font-medium text-slate-700 mb-1">{tLang.className}</label>
                <input
                  type="text"
                  id="className"
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddClass()}
                  className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                  placeholder={tLang.enterClassName}
                  autoFocus
                />
              </div>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end space-x-3">
              <button 
                onClick={() => { setShowAddClass(false); setNewClassName(''); }} 
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                {tLang.cancel}
              </button>
              <button 
                onClick={handleAddClass} 
                disabled={!newClassName.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-300"
              >
                {tLang.add}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Class Modal */}
      {classToDelete && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full overflow-hidden">
            <div className="p-6">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-4 mx-auto">
                <AlertCircle className="h-6 w-6 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 text-center mb-2">{tLang.deleteClass}</h3>
              <p className="text-slate-600 text-sm text-center mb-4">
                {tLang.deleteClassWarning.replace('{name}', data.classes.find((c: any) => c.id === classToDelete)?.name || '')}
              </p>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end space-x-3">
              <button 
                onClick={() => setClassToDelete(null)} 
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                {tLang.cancel}
              </button>
              <button 
                onClick={() => {
                  deleteClass(classToDelete);
                  setClassToDelete(null);
                }} 
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                {tLang.delete}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Points Modal */}
      {customPoints && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full overflow-hidden">
            <div className="p-6">
              <h3 className="text-lg font-bold text-slate-900 mb-4">{tLang.manualAdjustTitle}</h3>
              <p className="text-slate-600 text-sm mb-4">
                {tLang.manualAdjustDesc.replace('{name}', customPoints.name)}
              </p>
              <input
                type="number"
                min="1"
                value={pointsAmount}
                onChange={(e) => setPointsAmount(e.target.value)}
                className="w-full rounded-md border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                placeholder={tLang.manualAdjustPlaceholder}
                autoFocus
              />
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end space-x-3">
              <button 
                onClick={() => { setCustomPoints(null); setPointsAmount(''); }} 
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                {tLang.cancel}
              </button>
              <button 
                onClick={() => {
                  const amount = parseInt(pointsAmount, 10);
                  if (!isNaN(amount) && amount > 0) {
                    addPoints(customPoints.id, -amount);
                    setCustomPoints(null);
                    setPointsAmount('');
                  }
                }} 
                disabled={!pointsAmount || isNaN(parseInt(pointsAmount, 10)) || parseInt(pointsAmount, 10) <= 0}
                className="px-4 py-2 text-sm font-medium text-white bg-rose-600 border border-transparent rounded-md hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-rose-500 disabled:bg-rose-300"
              >
                {tLang.deduct}
              </button>
              <button 
                onClick={() => {
                  const amount = parseInt(pointsAmount, 10);
                  if (!isNaN(amount) && amount > 0) {
                    addPoints(customPoints.id, amount);
                    setCustomPoints(null);
                    setPointsAmount('');
                  }
                }} 
                disabled={!pointsAmount || isNaN(parseInt(pointsAmount, 10)) || parseInt(pointsAmount, 10) <= 0}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-300"
              >
                {tLang.increase}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {studentToDelete && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full overflow-hidden">
            <div className="p-6">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-4 mx-auto">
                <AlertCircle className="h-6 w-6 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-center text-slate-900 mb-2">{tLang.confirmDelete}</h3>
              <p className="text-center text-slate-500 text-sm">
                {tLang.deleteWarning.replace('{name}', data.classes.find((c: any) => c.id === data.currentClassId)?.students.find((s: any) => s.id === studentToDelete)?.name || '')}
              </p>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end space-x-3">
              <button 
                onClick={() => setStudentToDelete(null)} 
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                {tLang.cancel}
              </button>
              <button 
                onClick={() => {
                  deleteStudent(studentToDelete);
                  setStudentToDelete(null);
                }} 
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                {tLang.confirmDeleteBtn}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Classroom View Component ---
function ClassroomView({ data, feedPet, upgradePet, battle, gachaPet, animatingPets, lang, tLang }: any) {
  const [battleModalOpen, setBattleModalOpen] = useState(false);
  const [attackerId, setAttackerId] = useState<string | null>(null);
  const [defenderId, setDefenderId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'leaderboard'>('grid');

  const currentClass = data.classes.find((c: any) => c.id === data.currentClassId);
  const students = currentClass?.students || [];

  const handleOpenBattle = (id: string) => {
    setAttackerId(id);
    setBattleModalOpen(true);
  };

  const handleBattle = () => {
    if (attackerId && defenderId) {
      battle(attackerId, defenderId);
      setBattleModalOpen(false);
      setAttackerId(null);
      setDefenderId(null);
    }
  };

  // Sort students for leaderboard
  const sortedByRank = [...students].sort((a, b) => (b.rankPoints || 0) - (a.rankPoints || 0));

  const getRankInfo = (rp: number = 0) => {
    if (rp >= 400) return { name: tLang.diamond, color: 'text-cyan-500', bg: 'bg-cyan-100', icon: Crown };
    if (rp >= 300) return { name: tLang.platinum, color: 'text-teal-500', bg: 'bg-teal-100', icon: Sparkles };
    if (rp >= 200) return { name: tLang.gold, color: 'text-yellow-500', bg: 'bg-yellow-100', icon: Medal };
    if (rp >= 100) return { name: tLang.silver, color: 'text-gray-400', bg: 'bg-gray-100', icon: Award };
    return { name: tLang.bronze, color: 'text-amber-700', bg: 'bg-amber-100', icon: Shield };
  };

  return (
    <div className="min-h-full bg-amber-50/50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-extrabold text-amber-900 tracking-tight">{tLang.classroomTitle}</h1>
          <p className="mt-3 max-w-2xl mx-auto text-xl text-amber-700 sm:mt-4">
            {tLang.classroomDesc}
          </p>
          <div className="mt-6 flex justify-center space-x-4">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-4 py-2 rounded-full font-medium transition-colors ${viewMode === 'grid' ? 'bg-amber-500 text-white shadow-md' : 'bg-white text-amber-700 hover:bg-amber-100'}`}
            >
              <Users className="h-4 w-4 inline mr-2" />
              {tLang.classroomTitle}
            </button>
            <button
              onClick={() => setViewMode('leaderboard')}
              className={`px-4 py-2 rounded-full font-medium transition-colors ${viewMode === 'leaderboard' ? 'bg-amber-500 text-white shadow-md' : 'bg-white text-amber-700 hover:bg-amber-100'}`}
            >
              <BarChart3 className="h-4 w-4 inline mr-2" />
              {tLang.leaderboard}
            </button>
          </div>
        </div>

        {students.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl shadow-sm border-2 border-amber-100">
            <Dog className="h-16 w-16 text-amber-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-amber-900">{tLang.noPets}</h3>
            <p className="text-amber-700 mt-1">{tLang.addStudentFirst}</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {students.map((student: any) => (
              <PetCard 
                key={student.id} 
                student={student} 
                onFeed={() => feedPet(student.id)} 
                onUpgrade={() => upgradePet(student.id)}
                onBattle={() => handleOpenBattle(student.id)}
                onGacha={() => gachaPet(student.id)}
                isAnimating={animatingPets[student.id]}
                lang={lang}
                tLang={tLang}
                feedCost={data.settings?.feedCost ?? 10}
                getRankInfo={getRankInfo}
              />
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-amber-100 overflow-hidden max-w-4xl mx-auto">
            <div className="px-6 py-5 border-b border-amber-100 bg-amber-50 flex items-center justify-between">
              <h3 className="text-lg leading-6 font-medium text-amber-900 flex items-center">
                <Trophy className="h-5 w-5 mr-2 text-amber-500" />
                {tLang.leaderboard}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.studentName}</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.rank}</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.rankPoints}</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.winRate}</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{tLang.level}</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sortedByRank.map((student: any, idx: number) => {
                    const rankInfo = getRankInfo(student.rankPoints);
                    const RankIcon = rankInfo.icon;
                    const wins = student.stats?.wins || 0;
                    const losses = student.stats?.losses || 0;
                    const totalBattles = wins + losses;
                    const winRate = totalBattles > 0 ? Math.round((wins / totalBattles) * 100) : 0;
                    
                    return (
                      <tr key={student.id} className={idx < 3 ? 'bg-amber-50/30' : ''}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-8 w-8 bg-gray-100 rounded-full flex items-center justify-center">
                              {(() => {
                                const PetIcon = PET_TYPES.find(p => p.id === student.pet.type)?.icon || Dog;
                                return <PetIcon className="h-4 w-4 text-gray-600" />;
                              })()}
                            </div>
                            <div className="ml-3">
                              <div className="text-sm font-medium text-gray-900">{student.name}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${rankInfo.bg} ${rankInfo.color}`}>
                            <RankIcon className="h-3 w-3 mr-1" />
                            {rankInfo.name}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                          {student.rankPoints || 0}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          <div className="flex items-center">
                            <span className="mr-2">{winRate}%</span>
                            <span className="text-xs text-gray-400">({wins}W {losses}L)</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          Lv. {student.pet.level || 1}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Battle Modal */}
      {battleModalOpen && attackerId && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-gray-200">
              <h3 className="text-lg font-bold text-slate-900 flex items-center">
                <Swords className="h-5 w-5 mr-2 text-rose-500" />
                {tLang.selectOpponent}
              </h3>
              <button onClick={() => { setBattleModalOpen(false); setDefenderId(null); }} className="text-gray-400 hover:text-gray-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-gray-600 mb-4">
                {tLang.battleRules}
              </p>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {students.filter((s: any) => s.id !== attackerId).map((student: any) => (
                  <button
                    key={student.id}
                    onClick={() => setDefenderId(student.id)}
                    className={`w-full text-left px-4 py-3 rounded-lg border flex justify-between items-center transition-colors ${
                      defenderId === student.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center">
                      <div className="bg-white p-2 rounded-full shadow-sm mr-3">
                        {(() => {
                          const PetIcon = PET_TYPES.find(p => p.id === student.pet.type)?.icon || Dog;
                          return <PetIcon className="h-5 w-5 text-gray-600" />;
                        })()}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{student.name}</div>
                        <div className="text-xs text-gray-500">Lv. {student.pet.level || 1} | {tLang.petFullness}: {student.pet.fullness}</div>
                      </div>
                    </div>
                  </button>
                ))}
                {students.length <= 1 && (
                  <div className="text-center py-4 text-gray-500 text-sm">
                    {tLang.noOpponents}
                  </div>
                )}
              </div>
            </div>
            <div className="bg-gray-50 px-6 py-4 flex justify-end space-x-3">
              <button 
                onClick={() => { setBattleModalOpen(false); setDefenderId(null); }} 
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                {tLang.cancel}
              </button>
              <button 
                onClick={handleBattle} 
                disabled={!defenderId}
                className="px-4 py-2 text-sm font-medium text-white bg-rose-600 border border-transparent rounded-md hover:bg-rose-700 disabled:bg-rose-300 disabled:cursor-not-allowed"
              >
                {tLang.startBattle}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PetCard({ student, onFeed, onUpgrade, onBattle, onGacha, isAnimating, lang, tLang, feedCost, getRankInfo }: any) {
  const { name, points, pet, badges = [], rankPoints = 0 } = student;
  const { fullness, type, level = 1 } = pet;
  
  const petConfig = PET_TYPES.find(p => p.id === type) || PET_TYPES[0];
  const PetIcon = petConfig.icon;

  const isStrong = points >= 100 || fullness === 100;
  const isHappy = fullness > 70;
  const isNormal = fullness >= 30 && fullness <= 70;
  const isHungry = fullness < 30;
  const canFeed = points >= feedCost;
  const canBattle = fullness >= 50;
  const upgradeCost = 100 + (level - 1) * 50;
  const canUpgrade = level < 10 && fullness >= 100 && points >= upgradeCost;
  const canGacha = points >= 200;

  let StatusIcon = Smile;
  let statusText = tLang.statusHappy;
  let statusColor = "text-green-500";
  let bgColor = "bg-green-50";
  let borderColor = "border-green-200";

  if (isHungry) {
    StatusIcon = Frown;
    statusText = tLang.statusHungry;
    statusColor = "text-red-500";
    bgColor = "bg-red-50";
    borderColor = "border-red-200";
  } else if (isNormal) {
    StatusIcon = Meh;
    statusText = tLang.statusNormal;
    statusColor = "text-yellow-500";
    bgColor = "bg-yellow-50";
    borderColor = "border-yellow-200";
  }

  const evolutionStage = level >= 10 ? 3 : level >= 5 ? 2 : 1;
  const rankInfo = getRankInfo ? getRankInfo(rankPoints) : null;

  return (
    <div className={`relative bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-300 overflow-hidden border-2 ${borderColor}`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b ${borderColor} ${bgColor} flex justify-between items-center`}>
        <div className="flex flex-col">
          <span className="font-bold text-gray-800 text-lg flex items-center">
            {name}
            {rankInfo && (
              <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${rankInfo.bg} ${rankInfo.color}`} title={rankInfo.name}>
                <rankInfo.icon className="h-3 w-3 mr-0.5" />
                {rankPoints}
              </span>
            )}
          </span>
          <span className="text-xs font-bold text-amber-600 flex items-center">
            <Star className="h-3 w-3 mr-1 fill-amber-500" /> Lv. {level}
          </span>
        </div>
        <div className="flex items-center bg-white px-2 py-1 rounded-full shadow-sm">
          <span className="text-xs font-bold text-indigo-600 mr-1">{tLang.points}</span>
          <span className="font-black text-indigo-700">{points}</span>
        </div>
      </div>

      {/* Badges Area */}
      {badges.length > 0 && (
        <div className="absolute top-16 right-2 flex flex-col gap-1 z-20">
          {badges.includes('badgeFirstWin') && <div className="bg-amber-100 p-1 rounded-full shadow-sm border border-amber-200" title={tLang.badgeFirstWin}><Medal className="h-4 w-4 text-amber-600" /></div>}
          {badges.includes('badgeVeteran') && <div className="bg-rose-100 p-1 rounded-full shadow-sm border border-rose-200" title={tLang.badgeVeteran}><Swords className="h-4 w-4 text-rose-600" /></div>}
          {badges.includes('badgeRich') && <div className="bg-emerald-100 p-1 rounded-full shadow-sm border border-emerald-200" title={tLang.badgeRich}><Gift className="h-4 w-4 text-emerald-600" /></div>}
          {badges.includes('badgeMaxLevel') && <div className="bg-indigo-100 p-1 rounded-full shadow-sm border border-indigo-200" title={tLang.badgeMaxLevel}><Crown className="h-4 w-4 text-indigo-600" /></div>}
        </div>
      )}

      {/* Pet Visual Area */}
      <div className="p-6 flex flex-col items-center justify-center relative h-48 bg-gradient-to-b from-white to-amber-50/30">
        
        {/* Floating Hearts Animation */}
        {isAnimating && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <Heart className="text-pink-500 fill-pink-500 h-8 w-8 animate-[ping_1s_ease-out_forwards] absolute opacity-75" />
            <Heart className="text-pink-400 fill-pink-400 h-6 w-6 animate-[bounce_1s_ease-in-out_infinite] absolute -mt-16 ml-8" />
            <Heart className="text-pink-400 fill-pink-400 h-5 w-5 animate-[bounce_1.2s_ease-in-out_infinite] absolute -mt-12 -ml-10" />
          </div>
        )}

        {/* Pet Character */}
        <div className={`relative transition-all duration-500 ${isAnimating ? 'scale-125 -translate-y-4' : 'hover:scale-110'} ${evolutionStage >= 3 ? 'scale-110' : ''}`}>
          <div className={`p-4 rounded-full ${isStrong ? 'bg-amber-100' : bgColor} ${evolutionStage >= 2 ? 'shadow-[0_0_15px_rgba(251,191,36,0.6)]' : ''} ${evolutionStage >= 3 ? 'shadow-[0_0_25px_rgba(167,139,250,0.8)]' : ''}`}>
            {evolutionStage >= 3 && (
              <Crown className="h-6 w-6 text-yellow-500 absolute -top-4 left-1/2 transform -translate-x-1/2 z-10 drop-shadow-sm" />
            )}
            {isStrong ? (
              <div className="relative">
                <PetIcon className={`h-16 w-16 ${statusColor}`} strokeWidth={1.5} />
                <Dumbbell className="h-8 w-8 text-slate-700 absolute -right-2 -bottom-2 transform rotate-12" />
              </div>
            ) : (
              <PetIcon className={`h-16 w-16 ${statusColor}`} strokeWidth={1.5} />
            )}
            {evolutionStage >= 2 && (
              <Sparkles className="h-5 w-5 text-amber-400 absolute top-0 right-0 animate-pulse" />
            )}
          </div>
          
          {/* Status Badge */}
          <div className={`absolute -bottom-2 -right-2 bg-white rounded-full p-1 shadow-sm border ${borderColor}`} title={statusText}>
            <StatusIcon className={`h-5 w-5 ${statusColor}`} />
          </div>
        </div>

        {/* Fullness Bar */}
        <div className="w-full mt-6">
          <div className="flex justify-between text-xs mb-1 font-medium text-gray-500">
            <span>{tLang.petFullness}</span>
            <span>{fullness}/100</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden shadow-inner">
            <div 
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                isHungry ? 'bg-red-400' : isNormal ? 'bg-yellow-400' : 'bg-green-400'
              }`}
              style={{ width: `${fullness}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Action Area */}
      <div className="p-4 bg-gray-50 border-t border-gray-100 space-y-2">
        {type === 'egg' ? (
          <button
            onClick={onGacha}
            disabled={!canGacha}
            className={`w-full flex items-center justify-center py-3 px-4 rounded-xl font-bold text-sm transition-all duration-200 ${
              !canGacha
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white shadow-md hover:shadow-lg active:scale-95'
            }`}
          >
            <Dices className="h-5 w-5 mr-2 animate-bounce" />
            {tLang.gacha}
          </button>
        ) : (
          <>
            <button
              onClick={onFeed}
              disabled={!canFeed || fullness >= 100}
              className={`w-full flex items-center justify-center py-2 px-4 rounded-xl font-bold text-sm transition-all duration-200 ${
                !canFeed || fullness >= 100
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-amber-400 hover:bg-amber-500 text-amber-900 shadow-sm hover:shadow active:scale-95'
              }`}
            >
              <Utensils className="h-4 w-4 mr-2" />
              {fullness >= 100 ? tLang.alreadyFull : canFeed ? tLang.feedPet.replace('{cost}', feedCost.toString()) : tLang.notEnoughPoints}
            </button>

            <div className="flex space-x-2">
              <button
                onClick={onUpgrade}
                disabled={!canUpgrade}
                className={`flex-1 flex items-center justify-center py-2 px-2 rounded-xl font-bold text-xs transition-all duration-200 ${
                  !canUpgrade
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm hover:shadow active:scale-95'
                }`}
              >
                <Trophy className="h-3 w-3 mr-1" />
                {level >= 10 ? tLang.maxLevel : tLang.upgradePet.replace('{cost}', upgradeCost.toString())}
              </button>
              
              <button
                onClick={onBattle}
                disabled={!canBattle}
                className={`flex-1 flex items-center justify-center py-2 px-2 rounded-xl font-bold text-xs transition-all duration-200 ${
                  !canBattle
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-rose-500 hover:bg-rose-600 text-white shadow-sm hover:shadow active:scale-95'
                }`}
              >
                <Swords className="h-3 w-3 mr-1" />
                {tLang.battle}
              </button>
            </div>
            
            {(!canFeed || !canBattle || (!canUpgrade && level < 10)) && (
              <p className="text-center text-[10px] text-red-500 mt-2 flex flex-col items-center justify-center">
                {!canFeed && fullness < 100 && <span><AlertCircle className="h-3 w-3 inline mr-1" />{tLang.feedNeedPoints.replace('{cost}', feedCost.toString())}</span>}
                {!canBattle && <span><AlertCircle className="h-3 w-3 inline mr-1" />{tLang.battleNeedFullness}</span>}
                {!canUpgrade && level < 10 && fullness < 100 && <span><AlertCircle className="h-3 w-3 inline mr-1" />{tLang.upgradeNeedFullness}</span>}
                {!canUpgrade && level < 10 && fullness >= 100 && points < upgradeCost && <span><AlertCircle className="h-3 w-3 inline mr-1" />{tLang.upgradeNeedPoints.replace('{cost}', upgradeCost.toString())}</span>}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
