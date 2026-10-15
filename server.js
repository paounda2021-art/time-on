const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const XLSX = require('xlsx');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const PORT = process.env.PORT || 3005;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');
const dbStorage = require('./db.js');

const APP_VERSION = '2.1.0';
const APP_BUILD = '20261015-v2.1.0';

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Anti-Cache Middleware: Force browsers & Cloudflare to always fetch fresh HTML & API responses
app.use((req, res, next) => {
  res.setHeader('X-TimeOn-Version', APP_VERSION);
  if (req.path.endsWith('.html') || req.path === '/' || req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }
  next();
});

// Static assets with strict no-cache on HTML and validation on JS/CSS
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }
}));

app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads'), {
  maxAge: '1h'
}));

// Version Info REST endpoint
app.get('/api/version', (req, res) => {
  res.json({
    version: APP_VERSION,
    build: APP_BUILD,
    serverTime: Date.now()
  });
});

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Check if a user is System Admin (IT, Executives, HR Admins)
function isUserAdmin(user) {
  if (!user) return false;
  if (user.isAdmin) return true;
  const adminCodes = [
    '07170065', '07170183', '07171111', '07170001', '07170184', '07170185', '07170209',
    '07170141', '07170110', '07170087' // ภาพิมน, อัมพิกา, ขวัญชนก
  ];
  const code = user.empCode || '';
  if (adminCodes.includes(code)) return true;
  const role = user.role || '';
  return /แอดมิน|สารสนเทศ|คอมพิวเตอร์|ผู้ดูแลระบบ|admin/i.test(role);
}

function isUserHR(user) {
  if (!user) return false;
  return ['07170185', '07170209'].includes(user.empCode) || /HR|ทรัพยากรบุคคล/i.test(user.role || '');
}

// Access restricted strictly to Admin
function isUserHRorAdmin(user) {
  return isUserAdmin(user);
}

function getBangkokTimeStr(date = new Date()) {
  return date.toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Bangkok'
  });
}

// Avatar pool
const avatarList = [
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1548142813-c348350df52b?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1517849845537-4d257902454a?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1528892952291-009c663ce843?w=150&auto=format&fit=crop&q=80'
];

// FMO Personnel & 11 Divisions / Offices เรียงตามลำดับในเอกสาร รายชื่อหน่วยงาน69.txt
const thaiNames = [
  {
    "empCode": "07171111",
    "name": "นายปรีดา ยังสุขสถาพร",
    "nick": "เคน",
    "email": "preeda.y@fishmarket.co.th",
    "role": "ผู้อำนวยการองค์การสะพานปลา (ระดับ 11)",
    "dept": "ผู้บริหาร (ระดับ 11, 10)"
  },
  {
    "empCode": "07170006",
    "name": "น.ส.ปิยวรรณ แก้วกล้า",
    "nick": "อ๊อด",
    "email": "piyawan.k@fishmarket.co.th",
    "role": "ผู้อำนวยการฝ่าย",
    "dept": "ฝ่ายบัญชีการเงิน"
  },
  {
    "empCode": "07170008",
    "name": "นายประทุม จันทา",
    "nick": "ทุม",
    "email": "pratum.c@fishmarket.co.th",
    "role": "หัวหน้าสำนักงาน",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1"
  },
  {
    "empCode": "07170021",
    "name": "น.ส.สุปราณี พลวารี",
    "nick": "ณี",
    "email": "supranee.p@fishmarket.co.th",
    "role": "ผู้อำนวยการฝ่าย",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 2"
  },
  {
    "empCode": "07170023",
    "name": "นายอรรถชาติ วิสุทธิ์เสรีวงศ์",
    "nick": "บอย",
    "email": "attachard.v@fishmarket.co.th",
    "role": "เจ้าหน้าที่บริหารงานทัวไป",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1"
  },
  {
    "empCode": "07170024",
    "name": "นางจิรฐา ฤทธิ์อร่าม",
    "nick": "แหม่ม",
    "email": "jiratha.r@fishmarket.co.th",
    "role": "หัวหน้าสำนักงาน",
    "dept": "ฝ่ายส่งเสริมและโครงการพิเศษ"
  },
  {
    "empCode": "07170027",
    "name": "นางฐานิดา เตชะทองสิงห์",
    "nick": "แอน",
    "email": "thanida.t@fishmarket.co.th",
    "role": "หัวหน้าแผนกรับ-จ่าย",
    "dept": "ฝ่ายบัญชีการเงิน"
  },
  {
    "empCode": "07170028",
    "name": "นางปานจิต ปาลกะวงค์",
    "nick": "จิต",
    "email": "panchit.p@fishmarket.co.th",
    "role": "หัวหน้าสำนักงาน",
    "dept": "ฝ่ายสินเชื่อ"
  },
  {
    "empCode": "07170029",
    "name": "น.ส.สายสุนีย์ พูลวณิชย์สกุล",
    "nick": "หม่วย",
    "email": "saisunee.p@fishmarket.co.th",
    "role": "หัวหน้าสำนักงาน",
    "dept": "ฝ่ายบัญชีการเงิน"
  },
  {
    "empCode": "07170031",
    "name": "น.ส.ซารีนา หมาดรา",
    "nick": "ตุ๊ก",
    "email": "sarena.m@fishmarket.co.th",
    "role": "หัวหน้าสำนักงาน",
    "dept": "ฝ่ายบัญชีการเงิน"
  },
  {
    "empCode": "07170032",
    "name": "นางสุวรรณา ปาปี",
    "nick": "กุ้ง",
    "email": "suwanna.p@fishmarket.co.th",
    "role": "หัวหน้าสำนักงานการเงิน",
    "dept": "ฝ่ายบัญชีการเงิน"
  },
  {
    "empCode": "07170034",
    "name": "นางสุรนีย์ วรรณประพัฒน์",
    "nick": "อิ๋ว",
    "email": "suranee.w@fishmarket.co.th",
    "role": "หัวหน้าสำนักงาน",
    "dept": "ฝ่ายยุทธศาสตร์การพัฒนา"
  },
  {
    "empCode": "07170036",
    "name": "นางสิริฤทัย โรจนวิเชียร",
    "nick": "ยุ้ย",
    "email": "siriruethai.r@fishmarket.co.th",
    "role": "เจ้าหน้าที่นโยบายและแผน",
    "dept": "ฝ่ายส่งเสริมและโครงการพิเศษ"
  },
  {
    "empCode": "07170038",
    "name": "นายโอภาส พวงเขียว",
    "nick": "ภาส",
    "email": "opas.po@fishmarket.co.th",
    "role": "หัวหน้าสำนักงาน",
    "dept": "ฝ่ายบริหารและพัฒนาองค์กร"
  },
  {
    "empCode": "07170039",
    "name": "นายพิพัฒน์ จินดาหลวง",
    "nick": "หนุ่ม",
    "email": "pipat.j@fishmarket.co.th",
    "role": "เจ้าหน้าที่นโยบายและแผน",
    "dept": "ฝ่ายส่งเสริมและโครงการพิเศษ"
  },
  {
    "empCode": "07170041",
    "name": "น.ส.จรีลักษ์ เมืองอุดม",
    "nick": "อี๊ด",
    "email": "jareelak.m@fishmarket.co.th",
    "role": "เจ้าหน้าที่การเงินและบัญชี(ก/ง)",
    "dept": "สำนักงานบริหารหนี้"
  },
  {
    "empCode": "07170043",
    "name": "นายคณพล การไว",
    "nick": "ไก่",
    "email": "kanapol.k@fishmarket.co.th",
    "role": "เจ้าหน้าที่นโยบายและแผน",
    "dept": "ฝ่ายส่งเสริมและโครงการพิเศษ"
  },
  {
    "empCode": "07170046",
    "name": "นายอิทธิชัย โพธิ์งาม",
    "nick": "อิทธิ",
    "email": "",
    "role": "เจ้าหน้าที่ธุรการ",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1"
  },
  {
    "empCode": "07170047",
    "name": "นายพิรมณ์ บุญชู",
    "nick": "รมณ์",
    "email": "",
    "role": "เจ้าหน้าที่ธุรการ",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1"
  },
  {
    "empCode": "07170049",
    "name": "นายจักรพงษ์ ส้มฉุน",
    "nick": "พงษ์",
    "email": "chakrapog.s@fishmarket.co.th",
    "role": "เจ้าหน้าที่ธุรการ",
    "dept": "ฝ่ายส่งเสริมและโครงการพิเศษ"
  },
  {
    "empCode": "07170051",
    "name": "นางนฤมล บุญเจือ",
    "nick": "เปิ้ล",
    "email": "narumon.b@fishmarket.co.th",
    "role": "เจ้าหน้าที่การเงินและบัญชี",
    "dept": "ฝ่ายบัญชีการเงิน"
  },
  {
    "empCode": "07170052",
    "name": "นางนวรรณ กิจไพบูลทวี",
    "nick": "นา",
    "email": "nawan.k@fishmarket.co.th",
    "role": "หัวหน้าแผนก",
    "dept": "ฝ่ายบริหารและพัฒนาองค์กร"
  },
  {
    "empCode": "07170055",
    "name": "นายชาญชัย โชติชูทิพย์",
    "nick": "มอส",
    "email": "chanchai.c@fishmarket.co.th",
    "role": "ผู้อำนวยการฝ่าย",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1"
  },
  {
    "empCode": "07170060",
    "name": "นายนายธงชัย หอมหวล",
    "nick": "เก่ง",
    "email": "thongchai.h@fishmarket.co.th",
    "role": "เจ้าหน้าที่การเงินและบัญชี(ก/ง)",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1"
  },
  {
    "empCode": "07170062",
    "name": "นายปฏิยุทธ์ กิจไพบูลทวี",
    "nick": "ปอนด์",
    "email": "patiyoot.k@fishmarket.co.th",
    "role": "เจ้าหน้าที่สินเชื่อ",
    "dept": "ฝ่ายสินเชื่อ"
  },
  {
    "empCode": "07170063",
    "name": "ว่าที่ร.ต.สุภชัย เจริญอินทร์",
    "nick": "ตี๋",
    "email": "supachai.j@fishmarket.co.th",
    "role": "หัวหน้าแผนก",
    "dept": "ฝ่ายสินเชื่อ"
  },
  {
    "empCode": "07170065",
    "name": "น.ส.รณิดา โชติธนาอุดม",
    "nick": "หนิง",
    "email": "ranida.c@fishmarket.co.th",
    "role": "หัวหน้าสำนักงาน",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 2"
  },
  {
    "empCode": "07170066",
    "name": "นายเอกพล แพรดำ",
    "nick": "ตุ๋ย",
    "email": "ekapol.p@fishmarket.co.th",
    "role": "เจ้าหน้าที่การเงินและบัญชี",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1"
  },
  {
    "empCode": "07170070",
    "name": "น.ส.ธชธร ประยูรวงศ์",
    "nick": "ปอย",
    "email": "thachatthon.p@fishmarket.co.th",
    "role": "นักบัญชี",
    "dept": "ฝ่ายบัญชีการเงิน"
  },
  {
    "empCode": "07170076",
    "name": "น.ส.สุพรรณษา ธรรมโชติ",
    "nick": "แนน",
    "email": "supansa.t@fishmarket.co.th",
    "role": "เจ้าหน้าที่นโยบายและแผน",
    "dept": "ฝ่ายยุทธศาสตร์การพัฒนา"
  },
  {
    "empCode": "07170078",
    "name": "นายธนชัย ฉายศรี",
    "nick": "เอ๋",
    "email": "thanachai.c@fishmarket.co.th",
    "role": "เจ้าหน้าที่ตรวจสอบภายใน",
    "dept": "ฝ่ายตรวจสอบภายใน"
  },
  {
    "empCode": "07170079",
    "name": "ว่าที่ร.ต.มนตรี ภู่ขำ",
    "nick": "ตรี",
    "email": "montree.p@fishmarket.co.th",
    "role": "เจ้าหน้าที่นโยบายและแผน",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1"
  },
  {
    "empCode": "07170080",
    "name": "น.ส.กนกอร นพรัตน์",
    "nick": "แป้ง",
    "email": "kanokon.n@fishmarket.co.th",
    "role": "นักบัญชี",
    "dept": "ฝ่ายบัญชีการเงิน"
  },
  {
    "empCode": "07170081",
    "name": "น.ส.ตระการ​กุล ประเสริฐ​สม",
    "nick": "เต้น",
    "email": "trakarnkul.p@fishmarket.co.th",
    "role": "หัวหน้าสำนักงานกฎหมาย",
    "dept": "ฝ่ายบริหารและพัฒนาองค์กร"
  },
  {
    "empCode": "07170084",
    "name": "น.ส.พัชรียา สุตา",
    "nick": "กิ๊ฟ",
    "email": "patchareeya.s@fishmarket.co.th",
    "role": "เจ้าหน้าที่นโยบายและแผน",
    "dept": "ฝ่ายยุทธศาสตร์การพัฒนา"
  },
  {
    "empCode": "07170085",
    "name": "น.ส.รัตนา เหวิจิตร",
    "nick": "ติ๊กกี้",
    "email": "rattana.h@fishmarket.co.th",
    "role": "นักบัญชี",
    "dept": "ฝ่ายบัญชีการเงิน"
  },
  {
    "empCode": "07170087",
    "name": "น.ส.ขวัญชนก มีศรี",
    "nick": "แอม",
    "email": "khanchanok.m@fishmarket.co.th",
    "role": "บุคลากร",
    "dept": "ฝ่ายบริหารและพัฒนาองค์กร"
  },
  {
    "empCode": "07170088",
    "name": "น.ส.กันยาวีร์ ลิ้มอมรสวัสดิ์",
    "nick": "เมย์",
    "email": "ganyawee.l@fishmarket.co.th",
    "role": "เจ้าหน้าที่บริหารงานทั่วไป",
    "dept": "สำนักงานเลขานุการผู้อำนวยการ"
  },
  {
    "empCode": "07170089",
    "name": "น.ส.มณฑาทิพย์ จันทึก",
    "nick": "ก้อย",
    "email": "montatip.j@fishmarket.co.th",
    "role": "หัวหน้าแผนก",
    "dept": "สำนักงานอำนวยการ"
  },
  {
    "empCode": "07170091",
    "name": "นางอโรชา แว่นกิ่ง",
    "nick": "เบียร์",
    "email": "arochar.v@fishmarket.co.th",
    "role": "เจ้าหน้าที่การเงินและบัญชี",
    "dept": "ฝ่ายบัญชีการเงิน"
  },
  {
    "empCode": "07170093",
    "name": "น.ส.อรสุดา ไพบูลย์",
    "nick": "ฝน",
    "email": "onsuda.p@fishmarket.co.th",
    "role": "นักบัญชี",
    "dept": "ฝ่ายบัญชีการเงิน"
  },
  {
    "empCode": "07170098",
    "name": "น.ส.พิมพ์ลดา อัศวเศรษฐชัย",
    "nick": "แอน",
    "email": "pimrada.a@fishmarket.co.th",
    "role": "หัวหน้าแผนก",
    "dept": "สำนักงานอำนวยการ"
  },
  {
    "empCode": "07170099",
    "name": "นายไชยเชษฐ์ บุญส่ง",
    "nick": "ต่อ",
    "email": "chaiyachet.b@fishmarket.co.th",
    "role": "เจ้าหน้าที่นโยบายและแผน",
    "dept": "ฝ่ายสินเชื่อ"
  },
  {
    "empCode": "07170100",
    "name": "น.ส.กลิ่นเสลา บุญส่ง",
    "nick": "แนน",
    "email": "klinsalao.b@fishmarket.co.th",
    "role": "เจ้าหน้าที่นโยบายและแผน",
    "dept": "ฝ่ายยุทธศาสตร์การพัฒนา"
  },
  {
    "empCode": "07170102",
    "name": "น.ส.วิชญาพร​ เชียง​โชติ​",
    "nick": "เดียร์",
    "email": "witchayaphon.c@fishmarket.co.th",
    "role": "เจ้าหน้าที่นโยบายและแผน",
    "dept": "ฝ่ายยุทธศาสตร์การพัฒนา"
  },
  {
    "empCode": "07170105",
    "name": "นายฉลอง เจียมผักแว่น",
    "nick": "นาย",
    "email": "chalong.c@fishmarket.co.th",
    "role": "เจ้าหน้าที่การเงินและบัญชี",
    "dept": "ฝ่ายบัญชีการเงิน"
  },
  {
    "empCode": "07170106",
    "name": "นายสมศักดิ์ สายคำเคือง",
    "nick": "ศักดิ์",
    "email": "somsak.s@fishmarket.co.th",
    "role": "เจ้าหน้าที่ธุรการ",
    "dept": "ฝ่ายส่งเสริมและโครงการพิเศษ"
  },
  {
    "empCode": "07170110",
    "name": "น.ส.อัมพิกา เวรุวณารักษ์",
    "nick": "แก้ว",
    "email": "ampika.v@fishmarket.co.th",
    "role": "บุคลากร",
    "dept": "ฝ่ายบริหารและพัฒนาองค์กร"
  },
  {
    "empCode": "07170111",
    "name": "นายจิระพงศ์ ยังเจริญพร",
    "nick": "ป๊อป",
    "email": "jirapong.y@fishmarket.co.th",
    "role": "เจ้าหน้าที่ธุรการ",
    "dept": "ฝ่ายสินเชื่อ"
  },
  {
    "empCode": "07170115",
    "name": "นางกัลยา วงศ์สุวรรณ",
    "nick": "จิ๊กซอ",
    "email": "kanokkorn.k@fishmarket.co.th",
    "role": "เจ้าหน้าที่นโยบายและแผน",
    "dept": "สำนักงานบริหารหนี้"
  },
  {
    "empCode": "07170117",
    "name": "นายวันชาติ อ่วมด้วง",
    "nick": "ทช",
    "email": "wanchat.o@fishmarket.co.th",
    "role": "เจ้าหน้าที่ธุรการ",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1"
  },
  {
    "empCode": "07170120",
    "name": "น.ส.พัทธนันท์ บุญเชิดฉาย",
    "nick": "กิ๊ก",
    "email": "pattanan.b@fishmarket.co.th",
    "role": "เจ้าหน้าที่บริหารงานทั่วไป",
    "dept": "ฝ่ายส่งเสริมและโครงการพิเศษ"
  },
  {
    "empCode": "07170122",
    "name": "นายภานุวัฒน์ ตาลคง",
    "nick": "วัฒน์",
    "email": "panuwat.t@fishmarket.co.th",
    "role": "เจ้าหน้าที่ธุรการ",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1"
  },
  {
    "empCode": "07170133",
    "name": "น.ส.สิริญญา ยิ่งเภตรา",
    "nick": "โบว์",
    "email": "sirinya.y@fishmarket.co.th",
    "role": "เจ้าหน้าที่ธุรการ",
    "dept": "สำนักงานอำนวยการ"
  },
  {
    "empCode": "07170140",
    "name": "น.ส.ศศิภา ฤทธิ์มาก",
    "nick": "ภา",
    "email": "sasipa.r@fishmarket.co.th",
    "role": "เจ้าหน้าที่ตรวจสอบภายใน",
    "dept": "ฝ่ายตรวจสอบภายใน"
  },
  {
    "empCode": "07170141",
    "name": "น.ส.ภาพิมน ทรัพย์ประเสริฐ",
    "nick": "แอ้น",
    "email": "papimon.s@fishmarket.co.th",
    "role": "เจ้าหน้าที่ธุรการ",
    "dept": "ฝ่ายบริหารและพัฒนาองค์กร"
  },
  {
    "empCode": "07170144",
    "name": "นายยุววรรณ จันทวาท",
    "nick": "วรรณ",
    "email": "",
    "role": "เจ้าหน้าที่ธุรการ",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1"
  },
  {
    "empCode": "07170146",
    "name": "น.ส.ณัฏฐ์เมธินี จงสัจจา",
    "nick": "ป๊อป",
    "email": "natmethinee.c@fishmarket.co.th",
    "role": "เจ้าหน้าที่การเงินและบัญชี",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 2"
  },
  {
    "empCode": "07170147",
    "name": "นายมานพ เนตรวงค์",
    "nick": "มานพ",
    "email": "",
    "role": "เจ้าหน้าที่ธุรการ",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1"
  },
  {
    "empCode": "07170148",
    "name": "นายภานุวัฒน์ ลาดจันทึก",
    "nick": "ภานุ",
    "email": "",
    "role": "เจ้าหน้าที่ธุรการ",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1"
  },
  {
    "empCode": "07170053",
    "name": "นายประพุทธิ คงคำ",
    "nick": "พุทธิ์",
    "email": "",
    "role": "เจ้าหน้าที่ธุรการ",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1"
  },
  {
    "empCode": "07170157",
    "name": "นายนพรัตน์ สุภราช",
    "nick": "ฟลุ๊ค",
    "email": "nopparat.s@fishmarket.co.th",
    "role": "เจ้าหน้าที่บริหารงานทั่วไป",
    "dept": "สำนักงานอำนวยการ"
  },
  {
    "empCode": "07170158",
    "name": "น.ส.อมรรัตน์ ขุนทอง",
    "nick": "อร",
    "email": "amornrat.k@fishmarket.co.th",
    "role": "เจ้าหน้าที่ประชาสัมพันธ์",
    "dept": "สำนักงานอำนวยการ"
  },
  {
    "empCode": "07170161",
    "name": "นายศุภณัฐ ปัญจมะวัต",
    "nick": "ณัฐ",
    "email": "suppanut.p@fishmarket.co.th",
    "role": "เจ้าหน้าที่นโยบายและแผน",
    "dept": "ฝ่ายยุทธศาสตร์การพัฒนา"
  },
  {
    "empCode": "07170162",
    "name": "น.ส.รวินธรัณฎาษ์ อัครธิษาสิริ",
    "nick": "มิ้งค์",
    "email": "rawintharanda.a@fishmarket.co.th",
    "role": "เจ้าหน้าที่ตรวจสอบภายใน",
    "dept": "ฝ่ายตรวจสอบภายใน"
  },
  {
    "empCode": "07170163",
    "name": "นายพีรวัฒก์ ประดับวงษ์ยินดี",
    "nick": "โจ้",
    "email": "peerawat.p@fishmarket.co.th",
    "role": "ผู้อำนวยการฝ่าย",
    "dept": "ฝ่ายยุทธศาสตร์การพัฒนา"
  },
  {
    "empCode": "07170164",
    "name": "น.ส.จิราพร พงษ์ศิริ",
    "nick": "เอ๋",
    "email": "jiraporn.p@fishmarket.co.th",
    "role": "หัวหน้าสำนักงานบริหารหนี้ (ระดับ 8)",
    "dept": "สำนักงานบริหารหนี้"
  },
  {
    "empCode": "07170165",
    "name": "น.ส.เพ็ญพิชญ์ จันทรานภาภรณ์",
    "nick": "ส้ม",
    "email": "penpich.c@fishmarket.co.th",
    "role": "เจ้าหน้าที่นโยบายและแผน",
    "dept": "ฝ่ายยุทธศาสตร์การพัฒนา"
  },
  {
    "empCode": "07170167",
    "name": "น.ส.จิตฑามาศ ผลงาม",
    "nick": "กุ๊ก",
    "email": "jittamas.p@fishmarket.co.th",
    "role": "เจ้าหน้าที่บริหารงานทั่วไป",
    "dept": "สำนักงานบริหารหนี้"
  },
  {
    "empCode": "07170169",
    "name": "น.ส.ทิพาพร พลสยม",
    "nick": "จ๊ะเอ๋",
    "email": "tipaporn.p@fishmarket.co.th",
    "role": "เจ้าหน้าที่บริหารงานทั่วไป",
    "dept": "สำนักงานเลขานุการผู้อำนวยการ"
  },
  {
    "empCode": "07170170",
    "name": "น.ส.สุชาดา คงเกิด",
    "nick": "ปู",
    "email": "suchada.k@fishmarket.co.th",
    "role": "เจ้าหน้าที่บริหารงานทั่วไป",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 2"
  },
  {
    "empCode": "07170171",
    "name": "น.ส.ภาณุมาศ สุขจันทร์",
    "nick": "บี",
    "email": "panumas.s@fishmarket.co.th",
    "role": "เจ้าหน้าที่บริหารงานทั่วไป",
    "dept": "สำนักงานเลขานุการผู้อำนวยการ"
  },
  {
    "empCode": "07170174",
    "name": "นางพรทิพย์ ธราพร",
    "nick": "ตุ๊ก",
    "email": "pornthip.t@fishmarket.co.th",
    "role": "หัวหน้าสำนักงาน",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1"
  },
  {
    "empCode": "07170175",
    "name": "นายวสันต์ชัย ใจน้อย",
    "nick": "เจน",
    "email": "wasanchai.j@fishmarket.co.th",
    "role": "หัวหน้าสำนักงาน",
    "dept": "ฝ่ายส่งเสริมและโครงการพิเศษ"
  },
  {
    "empCode": "07170176",
    "name": "น.ส.กนกกร ศิลา",
    "nick": "ป้อม",
    "email": "kanokkorn.s@fishmarket.co.th",
    "role": "หัวหน้าสำนักงาน",
    "dept": "สำนักงานเลขานุการผู้อำนวยการ"
  },
  {
    "empCode": "07170178",
    "name": "น.ส.กัญญาภัค สวัสดี",
    "nick": "แดง",
    "email": "kanyaphak.s@fishmarket.co.th",
    "role": "หัวหน้าแผนก",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1"
  },
  {
    "empCode": "07170180",
    "name": "น.ส.ศิริลักษณ์ พันธุ์ดี",
    "nick": "แนน",
    "email": "siriluk.p@fishmarket.co.th",
    "role": "เจ้าหน้าที่บริหารงานทั่วไป",
    "dept": "ฝ่ายส่งเสริมและโครงการพิเศษ"
  },
  {
    "empCode": "07170183",
    "name": "น.ส.ณัฐอนงค์ แสงจันทร์งาม",
    "nick": "บุค",
    "email": "natanong.s@fishmarket.co.th",
    "role": "เจ้าหน้าที่บริหารงานทั่วไป",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 2"
  },
  {
    "empCode": "07170184",
    "name": "นายศุภชาติ ชาสมบัติ",
    "nick": "ชาติ",
    "email": "supbhachart.c@fishmarket.co.th",
    "role": "ด้านบริหาร (ระดับ 10) (รักษาการ รผอ.สป.ทร. / ปฏิบัติหน้าที่ รผอ.พกป.)",
    "dept": "ผู้บริหาร (ระดับ 11, 10)"
  },
  {
    "empCode": "07170185",
    "name": "นางนิติกร ขาวดี",
    "nick": "ปลา",
    "email": "nitikhon.k@fishmarket.co.th",
    "role": "ผู้อำนวยการฝ่าย",
    "dept": "ฝ่ายบริหารและพัฒนาองค์กร"
  },
  {
    "empCode": "07170186",
    "name": "นายนิกร จันทุม",
    "nick": "กร",
    "email": "nikorn.c@fishmarket.co.th",
    "role": "หัวหน้าสำนักงาน",
    "dept": "ฝ่ายส่งเสริมและโครงการพิเศษ"
  },
  {
    "empCode": "07170187",
    "name": "น.ส.พรทิพย์ นาแฉล้ม",
    "nick": "แคร์",
    "email": "phorntip.n@fishmarket.co.th",
    "role": "เจ้าหน้าที่บริหารงานทั่วไป",
    "dept": "ฝ่ายบริหารและพัฒนาองค์กร"
  },
  {
    "empCode": "07170189",
    "name": "ว่าที่ร.ต.วิโรจน์ รัตนอุไร",
    "nick": "อ๊อด",
    "email": "wirote.r@fishmarket.co.th",
    "role": "หัวหน้าสำนักงาน",
    "dept": "สำนักงานอำนวยการ"
  },
  {
    "empCode": "07170192",
    "name": "น.ส.นิโรบล ตั้งเพียร",
    "nick": "ปามมี่",
    "email": "nirobon.t@fishmarket.co.th",
    "role": "หัวหน้าสำนักงาน",
    "dept": "ฝ่ายส่งเสริมและโครงการพิเศษ"
  },
  {
    "empCode": "07170195",
    "name": "นายศักดา อภิรัตนวรรณ",
    "nick": "โอ้",
    "email": "sakda.a@fishmarket.co.th",
    "role": "เจ้าหน้าที่พัสดุ",
    "dept": "ฝ่ายบัญชีการเงิน"
  },
  {
    "empCode": "07170196",
    "name": "น.ส.สุธีรา แดงวิสุทธิ์",
    "nick": "ออ",
    "email": "suteera.d@fishmarket.co.th",
    "role": "เจ้าหน้าที่บริหารงานทั่วไป",
    "dept": "ฝ่ายส่งเสริมและโครงการพิเศษ"
  },
  {
    "empCode": "07170198",
    "name": "นายธีรภัทร เรืองถาวรนันท์",
    "nick": "ตุ้ย",
    "email": "teerapat.r@fishmarket.co.th",
    "role": "เจ้าหน้าที่บริหารงานทั่วไป",
    "dept": "ฝ่ายยุทธศาสตร์การพัฒนา"
  },
  {
    "empCode": "07170199",
    "name": "นายทศพร สุดชื่น",
    "nick": "นัท",
    "email": "tossaporn.s@fishmarket.co.th",
    "role": "นิติกร",
    "dept": "ฝ่ายบริหารและพัฒนาองค์กร"
  },
  {
    "empCode": "07170200",
    "name": "น.ส.เขมิกา สกุลแพทย์",
    "nick": "เกด",
    "email": "khemiga.s@fishmarket.co.th",
    "role": "เจ้าหน้าที่บริหารงานทั่วไป",
    "dept": "ฝ่ายบริหารและพัฒนาองค์กร"
  },
  {
    "empCode": "07170202",
    "name": "นายวรัญญู สามิบัติ",
    "nick": "ต๊อบ",
    "email": "warunyoo.s@fishmarket.co.th",
    "role": "วิศวกรโยธา",
    "dept": "ฝ่ายยุทธศาสตร์การพัฒนา"
  },
  {
    "empCode": "07170203",
    "name": "นายอรรถสิทธิ์ ตันติวิรัชกุล",
    "nick": "สิทธิ์",
    "email": "athasit.t@fishmarket.co.th",
    "role": "ผู้อำนวยการฝ่าย",
    "dept": "ฝ่ายสินเชื่อ"
  },
  {
    "empCode": "07170204",
    "name": "นายธีรนันท์ จันทน",
    "nick": "บิม",
    "email": "teeranan.c@fishmarket.co.th",
    "role": "เจ้าหน้าที่บริหารงานทั่วไป",
    "dept": "สำนักงานอำนวยการ"
  },
  {
    "empCode": "07170206",
    "name": "น.ส.สุชานาฏ ลิ่มสกุล",
    "nick": "นาฏ",
    "email": "suchanad.l@fishmarket.co.th",
    "role": "เจ้าหน้าที่บริหารงานทั่วไป",
    "dept": "ฝ่ายสะพานปลาและท่าเทียบเรือประมง 2"
  },
  {
    "empCode": "07170208",
    "name": "น.ส.กนกกร ควรชม",
    "nick": "เมย์",
    "email": "kanokkorn.k@fishmarket.co.th",
    "role": "นิติกร",
    "dept": "ฝ่ายบริหารและพัฒนาองค์กร"
  },
  {
    "empCode": "07170209",
    "name": "น.ส.ณัฏฐณิชา ฤทธิรุตม์",
    "nick": "นิชา",
    "email": "nuttanicha.r@fishmarket.co.th",
    "role": "นิติกร",
    "dept": "ฝ่ายบริหารและพัฒนาองค์กร"
  },
  {
    "empCode": "07170213",
    "name": "นายพนาดร พิมพ์ทรัพย์",
    "nick": "ออมสิน",
    "email": "panadon.p@fishmarket.co.th",
    "role": "หัวหน้าสำนักงาน",
    "dept": "ฝ่ายยุทธศาสตร์การพัฒนา"
  },
  {
    "empCode": "07170214",
    "name": "นายภูมิพัฒน์ ยงพาณิชย์",
    "nick": "นาย",
    "email": "phumiphat.y@fishmarket.co.th",
    "role": "นิติกร",
    "dept": "ฝ่ายบริหารและพัฒนาองค์กร"
  }
];

const mockNotes = [
  'ตรวจเอกสารเบิกจ่ายและรายงานการเงิน 📑',
  'ประชุมร่วมกับกระทรวงเกษตรและสหกรณ์ 🌾',
  'ประสานงานระบบท่าเทียบเรือและสะพานปลา ⚓',
  'บำรุงรักษาระบบเครือข่ายสารสนเทศ สทส. 💻',
  'จัดทำแผนยุทธศาสตร์และตัวชี้วัดผลงาน 📈',
  'พิจารณาสินเชื่อและบริหารความเสี่ยง 🐟',
  'พักเบรกดื่มกาแฟ ☕',
  'จัดเตรียมเอกสารการประชุมคณะกรรมการ อสป. 📋',
  'สำรวจพื้นที่สะพานปลากรุงเทพ / ท่าเทียบเรือ 🚢',
  'จัดทำรายงานสถิติสัตว์น้ำประจำสัปดาห์ 📊',
  'ตรวจสอบระบบควบคุมภายในและพัสดุ ⚙️'
];

function generateSeedUsers() {
  const now = Date.now();
  const statuses = ['available', 'available', 'available', 'busy', 'busy', 'break', 'idle', 'offline'];

  return thaiNames.map((item, idx) => {
    const id = `u${idx + 1}`;
    const avatar = avatarList[idx % avatarList.length];
    const status = statuses[idx % statuses.length];
    const note = mockNotes[idx % mockNotes.length];
    const isTabActive = status !== 'offline' && status !== 'idle';
    const location = (idx % 3 === 0) ? 'Office' : 'WFH';

    const checkInMin = 45 + (idx % 25);
    const checkInHour = checkInMin >= 60 ? 9 : 8;
    const formattedCheckIn = `0${checkInHour}:${(checkInMin % 60).toString().padStart(2, '0')}`;

    let attStatus = 'checked_in';
    let checkOutTime = null;
    let checkOutTimestamp = null;

    if (status === 'offline') {
      if (idx % 2 === 0) {
        attStatus = 'checked_out';
        checkOutTime = '12:30';
        checkOutTimestamp = now - 2 * 3600 * 1000;
      } else {
        attStatus = 'not_checked_in';
      }
    }

    return {
      id,
      empCode: item.empCode,
      name: item.name,
      nickname: item.nick,
      role: item.role,
      department: item.dept,
      phone: `02-211-7300 ต่อ ${String(100 + idx).padStart(3, '0')}`,
      email: `${item.nick ? item.nick.toLowerCase() : 'user'}.${item.empCode.slice(-4)}@fishmarket.co.th`,
      avatar,
      isHR: isUserHR(item),
      isAdmin: isUserAdmin(item),
      status,
      note: status === 'offline' ? 'เลิกงานแล้ว (ออฟไลน์)' : note,
      lastHeartbeat: now - (status === 'offline' ? 3 * 3600 * 1000 : (status === 'idle' ? 45 * 1000 : (idx * 2000 % 12000))),
      statusChangedAt: now - ((idx * 7 + 10) * 60 * 1000),
      isTabActive,
      attendance: {
        status: attStatus,
        location,
        checkInTime: attStatus !== 'not_checked_in' ? formattedCheckIn : null,
        checkInTimestamp: attStatus !== 'not_checked_in' ? (now - 5 * 3600 * 1000) : null,
        checkOutTime,
        checkOutTimestamp,
        note: attStatus === 'checked_in' ? `เข้างานตรงเวลา (${location})` : (attStatus === 'checked_out' ? 'ลงเวลาออกงาน' : 'ยังไม่ลงเวลา')
      }
    };
  });
}

const defaultUsers = generateSeedUsers();

const defaultActivityLogs = [
  {
    id: 'log-1',
    userId: 'u7',
    userName: 'น.ส.รณิดา โชติธนาอุดม',
    type: 'status_change',
    fromStatus: 'idle',
    toStatus: 'available',
    note: 'บำรุงรักษาระบบเครือข่ายสารสนเทศ สทส. 💻',
    timestamp: Date.now() - 45 * 60 * 1000
  },
  {
    id: 'log-2',
    userId: 'u4',
    userName: 'นายปรีดา ยังสุขสถาพร',
    type: 'status_change',
    fromStatus: 'available',
    toStatus: 'busy',
    note: 'ประชุมร่วมกับกระทรวงเกษตรและสหกรณ์ 🌾',
    timestamp: Date.now() - 20 * 60 * 1000
  },
  {
    id: 'log-3',
    userId: 'u28',
    userName: 'น.ส.ปิยวรรณ แก้วกล้า',
    type: 'status_change',
    fromStatus: 'available',
    toStatus: 'break',
    note: 'พักดื่มกาแฟ ☕',
    timestamp: Date.now() - 10 * 60 * 1000
  }
];

const defaultAttendanceLogs = [
  {
    id: 'att-1',
    userId: 'u7',
    userName: 'น.ส.รณิดา โชติธนาอุดม',
    action: 'check_in',
    location: 'WFH',
    time: '08:50',
    timestamp: Date.now() - 5.5 * 3600 * 1000,
    note: 'เริ่มงานตรงเวลา'
  },
  {
    id: 'att-2',
    userId: 'u4',
    userName: 'นายปรีดา ยังสุขสถาพร',
    action: 'check_in',
    location: 'Office',
    time: '08:30',
    timestamp: Date.now() - 6 * 3600 * 1000,
    note: 'ปฏิบัติหน้าที่สำนักงานใหญ่'
  },
  {
    id: 'att-3',
    userId: 'u1',
    userName: 'นายธนชัย ฉายศรี',
    action: 'check_in',
    location: 'WFH',
    time: '09:00',
    timestamp: Date.now() - 5.5 * 3600 * 1000,
    note: 'เริ่มงาน WFH ตรวจสอบภายใน'
  },
  {
    id: 'att-4',
    userId: 'u28',
    userName: 'น.ส.ปิยวรรณ แก้วกล้า',
    action: 'check_in',
    location: 'WFH',
    time: '08:45',
    timestamp: Date.now() - 5.2 * 3600 * 1000,
    note: 'ลงเวลาเข้างานฝ่ายบัญชีการเงิน'
  },
  {
    id: 'att-5',
    userId: 'u41',
    userName: 'นายพีรวัศก์ ประดับวงษ์ยินดี',
    action: 'check_in',
    location: 'Office',
    time: '09:05',
    timestamp: Date.now() - 5.4 * 3600 * 1000,
    note: 'ทำงานที่สำนักงาน'
  },
  {
    id: 'att-6',
    userId: 'u70',
    userName: 'นายชาญชัย โชติชูทิพย์',
    action: 'check_in',
    location: 'Office',
    time: '08:40',
    timestamp: Date.now() - 3 * 3600 * 1000,
    note: 'ลงพื้นที่ตรวจงานสะพานปลา'
  }
];

// Migrate from store.json into SQLite if not already migrated
dbStorage.migrateFromStoreJson(DB_FILE);
dbStorage.applyDefaultGenderAvatars();

let usersCache = dbStorage.getAllUsers();
if (!usersCache || usersCache.length < 90) {
  defaultUsers.forEach(u => dbStorage.saveUser(u));
  dbStorage.applyDefaultGenderAvatars();
  usersCache = dbStorage.getAllUsers();
}

// Active SQLite-backed DB facade
const db = {
  get users() {
    return usersCache;
  },
  activityLogs: {
    unshift(item) {
      dbStorage.addActivityLog(item);
    },
    slice(start, end) {
      return dbStorage.getActivityLogs(end || 50).slice(start, end);
    },
    get length() {
      return dbStorage.getActivityLogs(50).length;
    },
    map(fn) {
      return dbStorage.getActivityLogs(50).map(fn);
    },
    pop() {}
  },
  attendanceLogs: {
    unshift(item) {
      dbStorage.addAttendanceLog(item);
    },
    slice(start, end) {
      return dbStorage.getAttendanceLogs(end || 100).slice(start, end);
    },
    get length() {
      return dbStorage.getAttendanceLogs(100).length;
    },
    map(fn) {
      return dbStorage.getAttendanceLogs(100).map(fn);
    },
    pop() {}
  },
  nudges: {
    unshift(item) {
      dbStorage.addNudge(item);
    },
    slice(start, end) {
      return dbStorage.getNudges().slice(start, end);
    },
    get length() {
      return dbStorage.getNudges().length;
    },
    map(fn) {
      return dbStorage.getNudges().map(fn);
    },
    filter(fn) {
      return dbStorage.getNudges().filter(fn);
    },
    forEach(fn) {
      return dbStorage.getNudges().forEach(fn);
    },
    pop() {}
  }
};

function saveDB(user) {
  if (user) {
    dbStorage.saveUser(user);
    const idx = usersCache.findIndex(u => u.id === user.id);
    if (idx !== -1) usersCache[idx] = user;
  } else {
    usersCache.forEach(u => dbStorage.saveUser(u));
  }
}

function broadcast(message) {
  const payload = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Heartbeat & Idle Watchdog (Every 5 seconds)
setInterval(() => {
  const now = Date.now();
  let changed = false;

  const AUTO_IDLE_TIMEOUT = 5 * 60 * 1000;    // ขั้นที่ 1: ตรวจจับการลุกจากโต๊ะ (Auto-Idle: 5 นาที)
  const AUTO_OFFLINE_TIMEOUT = 10 * 60 * 1000; // ขั้นที่ 2: ตรวจจับการออกจากระบบ (Auto-Offline: 10 นาที)

  db.users.forEach((user) => {
    const timeSinceHeartbeat = now - (user.lastHeartbeat || 0);
    const timeInIdle = user.statusChangedAt ? (now - user.statusChangedAt) : timeSinceHeartbeat;

    // ขั้นที่ 1: ตรวจจับการลุกจากโต๊ะ (Auto-idle: นานเกิน 5 นาที)
    if ((user.status === 'available' || user.status === 'busy') && timeSinceHeartbeat > AUTO_IDLE_TIMEOUT) {
      const prevStatus = user.status;
      user.status = 'idle';
      user.statusChangedAt = now;
      user.note = 'ตรวจพบไม่มีการเคลื่อนไหว (Auto-Idle)';
      changed = true;

      const logEntry = {
        id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        userId: user.id,
        userName: user.name,
        type: 'auto_idle',
        fromStatus: prevStatus,
        toStatus: 'idle',
        note: user.note,
        timestamp: now
      };
      db.activityLogs.unshift(logEntry);
      if (db.activityLogs.length > 50) db.activityLogs.pop();

      broadcast({
        type: 'STATUS_UPDATED',
        user,
        log: logEntry
      });
    }

    // ขั้นที่ 2: ตรวจจับการออกจากระบบ (อยู่ในสถานะ ไม่อยู่ที่โต๊ะ ต่อเนื่องนานเกิน 10 นาที)
    if (user.status === 'idle' && (timeInIdle > AUTO_OFFLINE_TIMEOUT || timeSinceHeartbeat > (AUTO_IDLE_TIMEOUT + AUTO_OFFLINE_TIMEOUT))) {
      user.status = 'offline';
      user.statusChangedAt = now;
      user.note = 'ขาดการเชื่อมต่อนานเกินกำหนด (Auto-Offline)';
      changed = true;

      const logEntry = {
        id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        userId: user.id,
        userName: user.name,
        type: 'auto_offline',
        fromStatus: 'idle',
        toStatus: 'offline',
        note: user.note,
        timestamp: now
      };
      db.activityLogs.unshift(logEntry);
      if (db.activityLogs.length > 50) db.activityLogs.pop();

      broadcast({
        type: 'STATUS_UPDATED',
        user,
        log: logEntry
      });
    }

    // Check break timeout
    if (user.status === 'break' && user.breakUntil && now > user.breakUntil) {
      user.breakUntil = null;
      changed = true;
      broadcast({
        type: 'BREAK_EXPIRED',
        userId: user.id,
        userName: user.name
      });
    }
  });

  if (changed) {
    saveDB();
  }
}, 5000);

// WebSocket connection handling
wss.on('connection', (ws) => {
  try {
    ws.send(JSON.stringify({
      type: 'INIT',
      users: db.users,
      logs: db.activityLogs.slice(0, 30),
      attendanceLogs: db.attendanceLogs ? db.attendanceLogs.slice(0, 30) : [],
      nudges: db.nudges ? db.nudges.slice(0, 50) : [],
      serverTime: Date.now()
    }));
  } catch (err) {
    console.error('Error during WS INIT send:', err.message);
  }

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleClientMessage(msg, ws);
    } catch (err) {
      console.error('Invalid WS message:', err.message);
    }
  });
});

function handleClientMessage(msg, senderWs) {
  const now = Date.now();

  if (msg.type === 'HEARTBEAT') {
    const { userId, isTabActive } = msg;
    const user = db.users.find(u => u.id === userId);
    if (user) {
      user.lastHeartbeat = now;
      user.isTabActive = isTabActive !== false;

      if (user.status === 'idle') {
        user.status = 'available';
        user.statusChangedAt = now;
        user.note = 'กลับมาประจำการแล้ว 🟢';

        const logEntry = {
          id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          userId: user.id,
          userName: user.name,
          type: 'resumed_active',
          fromStatus: 'idle',
          toStatus: 'available',
          note: user.note,
          timestamp: now
        };
        db.activityLogs.unshift(logEntry);
        broadcast({
          type: 'STATUS_UPDATED',
          user,
          log: logEntry
        });
      } else {
        broadcast({
          type: 'HEARTBEAT_ACK',
          userId: user.id,
          lastHeartbeat: now,
          isTabActive: user.isTabActive
        });
      }
      saveDB();
    }
  } else if (msg.type === 'UPDATE_STATUS') {
    const { userId, status, note, breakMinutes } = msg;
    const user = db.users.find(u => u.id === userId);
    if (user) {
      const prevStatus = user.status;
      user.status = status;
      user.note = note || '';
      user.statusChangedAt = now;
      user.lastHeartbeat = now;

      if (status === 'break' && breakMinutes) {
        user.breakUntil = now + (breakMinutes * 60 * 1000);
      } else {
        user.breakUntil = null;
      }

      const logEntry = {
        id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        userId: user.id,
        userName: user.name,
        type: 'status_change',
        fromStatus: prevStatus,
        toStatus: status,
        note: user.note,
        timestamp: now
      };
      db.activityLogs.unshift(logEntry);
      if (db.activityLogs.length > 50) db.activityLogs.pop();

      saveDB();

      broadcast({
        type: 'STATUS_UPDATED',
        user,
        log: logEntry
      });
    }
  } else if (msg.type === 'CHECK_IN') {
    const { userId, location, note } = msg;
    const user = db.users.find(u => u.id === userId);
    if (user) {
      const timeStr = getBangkokTimeStr();
      user.attendance = {
        status: 'checked_in',
        location: location || 'WFH',
        checkInTime: timeStr,
        checkInTimestamp: now,
        checkOutTime: null,
        checkOutTimestamp: null,
        note: note || 'ลงเวลาเข้างานเรียบร้อย'
      };
      user.status = 'available';
      user.statusChangedAt = now;
      user.lastHeartbeat = now;
      user.note = `เข้างานแล้ว (${user.attendance.location}) พร้อมทำงาน 💻`;

      const attLog = {
        id: `att-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        userId: user.id,
        userName: user.name,
        action: 'check_in',
        location: user.attendance.location,
        time: timeStr,
        timestamp: now,
        note: note || ''
      };
      if (!db.attendanceLogs) db.attendanceLogs = [];
      db.attendanceLogs.unshift(attLog);
      if (db.attendanceLogs.length > 100) db.attendanceLogs.pop();

      const actLog = {
        id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        userId: user.id,
        userName: user.name,
        type: 'attendance_checkin',
        fromStatus: 'offline',
        toStatus: 'available',
        note: `ลงเวลาเข้างาน ${timeStr} (${user.attendance.location})`,
        timestamp: now
      };
      db.activityLogs.unshift(actLog);

      saveDB();

      broadcast({
        type: 'ATTENDANCE_UPDATED',
        user,
        attendanceLog: attLog,
        activityLog: actLog
      });
    }
  } else if (msg.type === 'CHECK_OUT') {
    const { userId, note } = msg;
    const user = db.users.find(u => u.id === userId);
    if (user) {
      const timeStr = getBangkokTimeStr();
      if (!user.attendance) {
        user.attendance = { status: 'not_checked_in', location: 'WFH', checkInTime: '09:00', checkInTimestamp: now - 8 * 3600 * 1000 };
      }
      user.attendance.status = 'checked_out';
      user.attendance.checkOutTime = timeStr;
      user.attendance.checkOutTimestamp = now;
      user.attendance.note = note || 'ลงเวลาเลิกงาน';

      user.status = 'offline';
      user.statusChangedAt = now;
      user.note = `เลิกงานแล้ว (${timeStr}) จบการทำงานวันนี้ 👋`;

      const attLog = {
        id: `att-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        userId: user.id,
        userName: user.name,
        action: 'check_out',
        location: user.attendance.location || 'WFH',
        time: timeStr,
        timestamp: now,
        note: note || ''
      };
      if (!db.attendanceLogs) db.attendanceLogs = [];
      db.attendanceLogs.unshift(attLog);
      if (db.attendanceLogs.length > 100) db.attendanceLogs.pop();

      const actLog = {
        id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        userId: user.id,
        userName: user.name,
        type: 'attendance_checkout',
        fromStatus: 'available',
        toStatus: 'offline',
        note: `ลงเวลาเลิกงาน ${timeStr}`,
        timestamp: now
      };
      db.activityLogs.unshift(actLog);

      saveDB();

      broadcast({
        type: 'ATTENDANCE_UPDATED',
        user,
        attendanceLog: attLog,
        activityLog: actLog
      });
    }
  } else if (msg.type === 'CLOCK_IN_BY_CODE') {
    const { empCode, location, note } = msg;
    const cleanCode = (empCode || '').trim();
    const user = db.users.find(u => 
      u.empCode === cleanCode || 
      u.empCode === cleanCode.padStart(8, '0') || 
      (cleanCode.length >= 3 && u.empCode.endsWith(cleanCode)) ||
      u.name.includes(cleanCode)
    );
    if (user) {
      const timeStr = getBangkokTimeStr();
      user.attendance = {
        status: 'checked_in',
        location: location || 'WFH',
        checkInTime: timeStr,
        checkInTimestamp: now,
        checkOutTime: null,
        checkOutTimestamp: null,
        note: note || `ลงเวลาเข้างาน ${location || 'WFH'} ด้วยรหัสพนักงาน`
      };
      user.status = 'available';
      user.statusChangedAt = now;
      user.lastHeartbeat = now;
      user.note = `เข้างานแล้ว (${user.attendance.location}) พร้อมทำงาน 💻`;

      const attLog = {
        id: `att-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        userId: user.id,
        userName: user.name,
        action: 'check_in',
        location: user.attendance.location,
        time: timeStr,
        timestamp: now,
        note: note || 'ลงเวลาด้วยรหัสพนักงาน'
      };
      if (!db.attendanceLogs) db.attendanceLogs = [];
      db.attendanceLogs.unshift(attLog);
      if (db.attendanceLogs.length > 100) db.attendanceLogs.pop();

      const actLog = {
        id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        userId: user.id,
        userName: user.name,
        type: 'attendance_checkin',
        fromStatus: 'offline',
        toStatus: 'available',
        note: `ลงเวลาเข้างาน ${timeStr} (${user.attendance.location}) [รหัส: ${user.empCode}]`,
        timestamp: now
      };
      db.activityLogs.unshift(actLog);
      if (db.activityLogs.length > 50) db.activityLogs.pop();

      saveDB();

      broadcast({
        type: 'ATTENDANCE_UPDATED',
        user,
        attendanceLog: attLog,
        activityLog: actLog,
        clockedInByCode: true
      });
    }
  } else if (msg.type === 'UPDATE_PROFILE') {
    const { userId, avatar, name, nickname, role, department, phone, email } = msg;
    const user = db.users.find(u => u.id === userId);
    if (user) {
      if (avatar && avatar.startsWith('data:image/')) {
        user.avatar = dbStorage.saveAvatarFile(user.empCode || user.id, avatar);
      } else if (avatar) {
        user.avatar = avatar;
      }
      if (name) user.name = name.trim();
      if (nickname) user.nickname = nickname.trim();
      if (role) user.role = role.trim();
      if (department) user.department = department.trim();
      if (phone !== undefined) user.phone = phone.trim();
      if (email !== undefined) user.email = email.trim();

      const actLog = {
        id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        userId: user.id,
        userName: user.name,
        type: 'profile_updated',
        fromStatus: user.status,
        toStatus: user.status,
        note: `อัปเดตข้อมูลส่วนตัวและรูปโปรไฟล์สำเร็จ`,
        timestamp: now
      };
      db.activityLogs.unshift(actLog);
      if (db.activityLogs.length > 50) db.activityLogs.pop();

      saveDB(user);

      broadcast({
        type: 'PROFILE_UPDATED',
        user,
        activityLog: actLog
      });
    }
  } else if (msg.type === 'SEND_NUDGE') {
    const { fromUserId, toUserId, message } = msg;
    const sender = db.users.find(u => u.id === fromUserId || u.empCode === fromUserId);
    const target = db.users.find(u => u.id === toUserId || u.empCode === toUserId);

    if (sender && target) {
      if (!db.nudges) db.nudges = [];
      const newNudge = {
        id: `nudge-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        fromUser: { id: sender.id, name: sender.name, nickname: sender.nickname, avatar: sender.avatar, role: sender.role },
        toUserId: target.id,
        toUserName: target.name,
        message: message || 'ขอคุยปรึกษางานสั้นๆ สัก 5 นาที สะดวกไหมครับ/ค่ะ? 😊',
        timestamp: now,
        read: false
      };
      db.nudges.unshift(newNudge);
      if (db.nudges.length > 200) db.nudges.pop();
      saveDB();

      broadcast({
        type: 'NUDGE_RECEIVED',
        nudge: newNudge,
        nudges: db.nudges ? db.nudges.slice(0, 50) : [],
        fromUser: newNudge.fromUser,
        toUserId: target.id,
        message: newNudge.message,
        timestamp: now
      });
    }
  } else if (msg.type === 'READ_NUDGES') {
    const { userId } = msg;
    dbStorage.markNudgesAsRead(userId);
    broadcast({ type: 'NUDGES_UPDATED', userId, nudges: dbStorage.getNudges() });
  }
}

// REST Endpoints
app.get('/api/users', (req, res) => {
  res.json({ users: db.users, serverTime: Date.now() });
});

// Admin Reset Attendance & Database Endpoint
app.all(['/api/reset-attendance', '/api/admin/reset-database'], (req, res) => {
  const now = Date.now();
  const keepIds = ['u6', 'u20', 'u89', 'u90'];

  try {
    const rawDb = dbStorage.db;

    // 1. Reset all other 94 employees to fresh offline / not_checked_in state
    const resetStmt = rawDb.prepare(`
      UPDATE users SET
        status = 'offline',
        statusChangedAt = ?,
        note = '',
        breakUntil = NULL,
        isTabActive = 0,
        attendanceStatus = 'not_checked_in',
        attendanceLocation = 'WFH',
        attendanceCheckInTime = NULL,
        attendanceCheckInTimestamp = NULL,
        attendanceCheckOutTime = NULL,
        attendanceCheckOutTimestamp = NULL,
        attendanceNote = ''
      WHERE id NOT IN ('u6', 'u20', 'u89', 'u90')
    `);
    const resUsers = resetStmt.run(now);

    // 2. Explicitly ensure the 4 active users are in 'available' status with proper check-in time
    const setRealStmt = rawDb.prepare(`
      UPDATE users SET
        status = 'available',
        statusChangedAt = ?,
        lastHeartbeat = ?,
        attendanceStatus = 'checked_in',
        attendanceLocation = 'WFH',
        attendanceCheckInTime = ?,
        attendanceCheckInTimestamp = COALESCE(attendanceCheckInTimestamp, ?),
        note = ?
      WHERE id = ?
    `);
    setRealStmt.run(now, now, '08:51', now, 'พร้อมทำงาน 🟢', 'u6');
    setRealStmt.run(now, now, '09:11', now, 'พร้อมทำงาน 🟢', 'u20');
    setRealStmt.run(now, now, '08:02', now, 'พร้อมคุยแล้ว 🟢', 'u89');
    setRealStmt.run(now, now, '11:22', now, 'พร้อมทำงาน 🟢', 'u90');

    // 3. Clean attendance_logs & activity_logs for all other users
    rawDb.prepare(`DELETE FROM attendance_logs WHERE userId NOT IN ('u6', 'u20', 'u89', 'u90')`).run();
    rawDb.prepare(`DELETE FROM activity_logs WHERE userId NOT IN ('u6', 'u20', 'u89', 'u90')`).run();

    // 4. Reload in-memory users cache
    usersCache = dbStorage.getAllUsers();

    // 5. Broadcast REFRESH_USERS to all connected clients
    broadcast({
      type: 'REFRESH_USERS',
      users: usersCache,
      logs: dbStorage.getActivityLogs(50),
      attendanceLogs: dbStorage.getAttendanceLogs(50),
      serverTime: now
    });

    const kept = usersCache.filter(u => keepIds.includes(u.id));

    res.json({
      success: true,
      message: `รีเซ็ตฐานข้อมูลเรียบร้อยแล้ว คงเหลือ 4 ท่านที่เข้างานจริง`,
      resetCount: resUsers.changes,
      keptUsers: kept.map(u => ({ id: u.id, empCode: u.empCode, name: u.name, checkInTime: u.attendance?.checkInTime, status: u.status }))
    });
  } catch (err) {
    console.error('Error resetting database:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Activity Logs REST endpoint
app.get(['/api/logs', '/api/activity-logs'], (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json({ logs: dbStorage.getActivityLogs(limit) });
});

// Attendance Logs REST endpoint
app.get(['/api/attendance/logs', '/api/attendance-logs'], (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json({ logs: dbStorage.getAttendanceLogs(limit) });
});

app.get('/api/attendance', (req, res) => {
  const userId = req.query.userId;
  if (userId) {
    const user = db.users.find(u => u.id === userId || u.empCode === userId);
    if (user && !isUserHRorAdmin(user)) {
      return res.status(403).json({
        authorized: false,
        error: 'เฉพาะฝ่ายทรัพยากรบุคคล (HR) และผู้ดูแลระบบเท่านั้นที่มีสิทธิ์ดูตารางนี้',
        user: { id: user.id, name: user.name, role: user.role, department: user.department }
      });
    }
  }

  res.json({
    authorized: true,
    users: db.users.map(u => ({
      id: u.id,
      empCode: u.empCode,
      name: u.name,
      nickname: u.nickname,
      role: u.role,
      department: u.department,
      status: u.status,
      attendance: u.attendance,
      isHR: u.isHR,
      isAdmin: u.isAdmin
    })),
    logs: db.attendanceLogs ? db.attendanceLogs.slice(0, 100) : []
  });
});

// Update User Status REST endpoint
app.post(['/api/users/:id/status', '/api/user/status'], (req, res) => {
  const userId = req.params.id || req.body.userId;
  const { status, note, breakMinutes } = req.body;
  const user = db.users.find(u => u.id === userId || u.empCode === userId);
  if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้งาน' });

  const prevStatus = user.status;
  const now = Date.now();
  user.status = status || 'available';
  user.note = note || '';
  user.statusChangedAt = now;
  user.lastHeartbeat = now;
  if (status === 'break' && breakMinutes) {
    user.breakUntil = now + (breakMinutes * 60 * 1000);
  } else {
    user.breakUntil = null;
  }

  const logEntry = {
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    userId: user.id,
    userName: user.name,
    type: 'status_change',
    fromStatus: prevStatus,
    toStatus: user.status,
    note: user.note,
    timestamp: now
  };
  db.activityLogs.unshift(logEntry);
  if (db.activityLogs.length > 50) db.activityLogs.pop();
  saveDB(user);

  broadcast({
    type: 'STATUS_UPDATED',
    user,
    log: logEntry
  });

  res.json({ success: true, user, log: logEntry });
});

// Send Nudge REST endpoint
app.post('/api/nudges', (req, res) => {
  const { fromUserId, toUserId, message } = req.body;
  const sender = db.users.find(u => u.id === fromUserId || u.empCode === fromUserId);
  const target = db.users.find(u => u.id === toUserId || u.empCode === toUserId);
  if (!sender || !target) return res.status(404).json({ error: 'ไม่พบผู้ส่งหรือผู้รับ' });

  const now = Date.now();
  const newNudge = {
    id: `nudge-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    fromUser: { id: sender.id, name: sender.name, nickname: sender.nickname, avatar: sender.avatar, role: sender.role },
    toUserId: target.id,
    toUserName: target.name,
    message: message || 'ขอคุยปรึกษางานสั้นๆ สัก 5 นาที สะดวกไหมครับ/ค่ะ? 😊',
    timestamp: now,
    read: false
  };
  db.nudges.unshift(newNudge);
  if (db.nudges.length > 200) db.nudges.pop();
  saveDB();

  broadcast({
    type: 'NUDGE_RECEIVED',
    nudge: newNudge,
    nudges: db.nudges ? db.nudges.slice(0, 50) : [],
    fromUser: newNudge.fromUser,
    toUserId: target.id,
    message: newNudge.message,
    timestamp: now
  });

  res.json({ success: true, nudge: newNudge });
});

// ============================================================
// 4-DIGIT PIN AUTHENTICATION (สำหรับทุกคนเพื่อยืนยันตัวตน)
// ============================================================

// 1. Set 4-Digit PIN (ยืนยัน 2 ครั้ง และบันทึกลง SQLite)
app.post(['/api/user/set-pin', '/api/admin/set-pin'], (req, res) => {
  const { userId, empCode, pin } = req.body;
  const cleanCode = (empCode || '').trim();
  const user = db.users.find(u => (userId && u.id === userId) || (cleanCode && u.empCode === cleanCode));
  if (!user) {
    return res.status(404).json({ success: false, error: 'ไม่พบข้อมูลพนักงาน' });
  }

  const cleanPin = String(pin || '').trim();
  if (!/^\d{4}$/.test(cleanPin)) {
    return res.status(400).json({ success: false, error: 'รหัส PIN ต้องเป็นตัวเลข 4 หลักเท่านั้น (0-9)' });
  }

  // Save to SQLite
  dbStorage.setUserPin(user.id, cleanPin);
  user.pin = cleanPin;
  user.hasPin = true;

  const now = Date.now();
  const actLog = {
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    userId: user.id,
    userName: user.name,
    type: 'pin_set',
    fromStatus: user.status,
    toStatus: user.status,
    note: `${user.name} ได้ตั้งค่ารหัส PIN 4 หลักเพื่อยืนยันตัวตนเรียบร้อยแล้ว 🔐`,
    timestamp: now
  };
  db.activityLogs.unshift(actLog);
  if (db.activityLogs.length > 50) db.activityLogs.pop();

  saveDB(user);
  broadcast({ type: 'USER_PIN_UPDATED', userId: user.id, hasPin: true });

  res.json({
    success: true,
    message: `ตั้งค่ารหัส PIN 4 หลักของ ${user.name} เรียบร้อยแล้ว`,
    user: { id: user.id, name: user.name, empCode: user.empCode, hasPin: true }
  });
});

// 2. Verify 4-Digit PIN
app.post(['/api/user/verify-pin', '/api/admin/verify-pin'], (req, res) => {
  const { userId, empCode, pin } = req.body;
  const cleanCode = (empCode || '').trim();
  const user = db.users.find(u => (userId && u.id === userId) || (cleanCode && u.empCode === cleanCode));
  if (!user) {
    return res.status(404).json({ success: false, error: 'ไม่พบข้อมูลพนักงาน' });
  }

  if (!user.pin) {
    return res.status(400).json({ success: false, needSetup: true, error: 'ยังไม่ได้ตั้งค่ารหัส PIN 4 หลัก กรุณาตั้ง PIN ก่อนเข้าใช้งาน' });
  }

  const cleanPin = String(pin || '').trim();
  if (user.pin !== cleanPin) {
    return res.status(401).json({ success: false, error: 'รหัส PIN 4 หลักไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง' });
  }

  res.json({
    success: true,
    verified: true,
    message: 'ยืนยันรหัส PIN ถูกต้อง',
    user: { id: user.id, name: user.name, empCode: user.empCode, role: user.role, department: user.department, isAdmin: user.isAdmin, isHR: user.isHR }
  });
});

// ============================================================
// ADMIN EMPLOYEE MANAGEMENT API (เพิ่ม / แก้ไข / ลบ พนักงาน)
// ============================================================

// 1. Add Employee (เพิ่มพนักงานใหม่)
app.post('/api/admin/users', (req, res) => {
  const { adminId, adminUserId, empCode, name, nickname, role, department, phone, email, isAdmin, attendanceLocation, location } = req.body;
  const callerId = adminId || adminUserId;
  const adminUser = db.users.find(u => u.id === callerId || u.empCode === callerId);
  if (!adminUser || !isUserHRorAdmin(adminUser)) {
    return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่มีสิทธิ์เพิ่มพนักงาน' });
  }

  const cleanCode = (empCode || '').trim();
  const cleanName = (name || '').trim();
  const cleanNick = (nickname || '').trim();
  const cleanRole = (role || '').trim();
  const cleanDept = (department || '').trim();
  const cleanPhone = (phone || '').trim() || '02-211-7300';
  const cleanEmail = (email || '').trim() || `${cleanNick ? cleanNick.toLowerCase() : 'user'}.${cleanCode.slice(-4)}@fishmarket.co.th`;

  if (!cleanCode || !cleanName || !cleanRole || !cleanDept) {
    return res.status(400).json({ error: 'กรุณากรอกรหัสพนักงาน ชื่อ-สกุล ตำแหน่ง และฝ่ายงาน ให้ครบถ้วน' });
  }

  const existingCode = db.users.find(u => u.empCode === cleanCode);
  if (existingCode) {
    return res.status(400).json({ error: `รหัสพนักงาน "${cleanCode}" มีอยู่ในระบบแล้ว (${existingCode.name})` });
  }

  // Generate unique ID
  const nextNum = Math.max(...db.users.map(u => parseInt(u.id.replace(/\D/g, '') || '0', 10)), 0) + 1;
  const newId = `u${nextNum}`;
  const now = Date.now();
  const avatar = req.body.avatar || dbStorage.getDefaultAvatarByName(cleanName);

  const newUser = {
    id: newId,
    empCode: cleanCode,
    name: cleanName,
    nickname: cleanNick,
    role: cleanRole,
    department: cleanDept,
    avatar,
    phone: cleanPhone,
    email: cleanEmail,
    status: 'available',
    statusChangedAt: now,
    note: 'พร้อมปฏิบัติงาน',
    breakUntil: null,
    lastHeartbeat: now,
    isTabActive: true,
    isAdmin: !!isAdmin,
    isHR: cleanDept === 'ฝ่ายบริหารและพัฒนาองค์กร',
    attendance: {
      status: 'not_checked_in',
      location: attendanceLocation || 'WFH',
      checkInTime: null,
      checkInTimestamp: null,
      checkOutTime: null,
      checkOutTimestamp: null,
      note: 'ยังไม่ลงเวลา'
    }
  };

  dbStorage.saveUser(newUser);
  usersCache.push(newUser);

  const logEntry = {
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    userId: newUser.id,
    userName: newUser.name,
    type: 'admin_add_user',
    fromStatus: '',
    toStatus: 'available',
    note: `เพิ่มพนักงานใหม่: ${newUser.name} (${newUser.department}) โดย ${adminUser.name}`,
    timestamp: now
  };
  db.activityLogs.unshift(logEntry);
  if (db.activityLogs.length > 50) db.activityLogs.pop();

  broadcast({
    type: 'USER_ADDED',
    user: newUser,
    users: db.users,
    log: logEntry
  });

  res.json({ success: true, user: newUser, message: `เพิ่มพนักงาน ${newUser.name} เรียบร้อยแล้ว` });
});

// 2. Edit Employee (แก้ไขข้อมูลพนักงานโดย Admin)
app.put('/api/admin/users/:id', (req, res) => {
  const { id } = req.params;
  const { adminId, adminUserId, empCode, name, nickname, role, department, phone, email, isAdmin, status, attendanceLocation, avatar } = req.body;
  const callerId = adminId || adminUserId;
  const adminUser = db.users.find(u => u.id === callerId || u.empCode === callerId);
  if (!adminUser || !isUserHRorAdmin(adminUser)) {
    return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่มีสิทธิ์แก้ไขข้อมูลพนักงาน' });
  }

  const user = db.users.find(u => u.id === id);
  if (!user) return res.status(404).json({ error: 'ไม่พบพนักงานที่ต้องการแก้ไข' });

  const cleanCode = (empCode || '').trim();
  const cleanName = (name || '').trim();
  const cleanNick = (nickname || '').trim();
  const cleanRole = (role || '').trim();
  const cleanDept = (department || '').trim();
  const cleanPhone = (phone || '').trim();
  const cleanEmail = (email || '').trim();

  if (cleanCode && cleanCode !== user.empCode) {
    const dup = db.users.find(u => u.empCode === cleanCode && u.id !== id);
    if (dup) return res.status(400).json({ error: `รหัสพนักงาน "${cleanCode}" มีอยู่ในระบบแล้ว (${dup.name})` });
    user.empCode = cleanCode;
  }

  if (cleanName) user.name = cleanName;
  if (cleanNick !== undefined) user.nickname = cleanNick;
  if (cleanRole) user.role = cleanRole;
  if (cleanDept) user.department = cleanDept;
  if (cleanPhone) user.phone = cleanPhone;
  if (cleanEmail) user.email = cleanEmail;
  if (isAdmin !== undefined) user.isAdmin = !!isAdmin;
  if (cleanDept === 'ฝ่ายบริหารและพัฒนาองค์กร') user.isHR = true;
  if (status && ['available', 'busy', 'break', 'idle', 'offline'].includes(status)) {
    user.status = status;
    user.statusChangedAt = Date.now();
  }
  if (attendanceLocation && user.attendance) {
    user.attendance.location = attendanceLocation;
  }

  if (avatar && avatar.startsWith('data:image/')) {
    user.avatar = dbStorage.saveAvatarFile(user.empCode || user.id, avatar);
  } else if (avatar) {
    user.avatar = avatar;
  }

  dbStorage.saveUser(user);
  const cacheIdx = usersCache.findIndex(u => u.id === user.id);
  if (cacheIdx !== -1) usersCache[cacheIdx] = user;

  const now = Date.now();
  const logEntry = {
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    userId: user.id,
    userName: user.name,
    type: 'admin_edit_user',
    fromStatus: user.status,
    toStatus: user.status,
    note: `แก้ไขข้อมูลพนักงาน: ${user.name} โดยผู้ดูแลระบบ (${adminUser.name})`,
    timestamp: now
  };
  db.activityLogs.unshift(logEntry);
  if (db.activityLogs.length > 50) db.activityLogs.pop();

  broadcast({
    type: 'USER_UPDATED',
    user,
    users: db.users,
    log: logEntry
  });

  res.json({ success: true, user, message: `อัปเดตข้อมูลของ ${user.name} สำเร็จแล้ว` });
});

// 3. Delete Employee (ลบพนักงานโดย Admin)
app.delete('/api/admin/users/:id', (req, res) => {
  const { id } = req.params;
  const callerId = req.query.adminId || req.query.adminUserId || req.body?.adminId || req.body?.adminUserId;
  const adminUser = db.users.find(u => u.id === callerId || u.empCode === callerId);
  if (!adminUser || !isUserHRorAdmin(adminUser)) {
    return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่มีสิทธิ์ลบพนักงาน' });
  }

  const user = db.users.find(u => u.id === id);
  if (!user) return res.status(404).json({ error: 'ไม่พบพนักงานที่ต้องการลบ' });

  if (user.id === adminUser.id || user.empCode === adminUser.empCode) {
    return res.status(400).json({ error: 'ไม่สามารถลบบัญชีผู้ดูแลระบบของตนเองที่กำลังล็อกอินอยู่ได้' });
  }

  const deletedName = user.name;
  const deletedDept = user.department;

  dbStorage.deleteUser(id);
  usersCache = usersCache.filter(u => u.id !== id);

  const now = Date.now();
  const logEntry = {
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    userId: id,
    userName: deletedName,
    type: 'admin_delete_user',
    fromStatus: user.status,
    toStatus: 'offline',
    note: `ลบพนักงาน: ${deletedName} (${deletedDept}) โดยผู้ดูแลระบบ (${adminUser.name})`,
    timestamp: now
  };
  db.activityLogs.unshift(logEntry);
  if (db.activityLogs.length > 50) db.activityLogs.pop();

  broadcast({
    type: 'USER_DELETED',
    userId: id,
    userName: deletedName,
    users: db.users,
    log: logEntry
  });

  res.json({ success: true, message: `ลบข้อมูลของ ${deletedName} เรียบร้อยแล้ว` });
});

// Export Attendance Report (Excel .xlsx / CSV .csv) - Restricted to HR & Admin
app.get('/api/attendance/export', (req, res) => {
  const { format, userId, startDate, endDate } = req.query;

  // Permission check: if userId supplied, ensure HR or Admin
  if (userId) {
    const requestingUser = db.users.find(u => u.id === userId || u.empCode === userId);
    if (requestingUser && !isUserHRorAdmin(requestingUser)) {
      return res.status(403).json({
        error: 'เฉพาะฝ่ายทรัพยากรบุคคล (HR) และผู้ดูแลระบบเท่านั้นที่มีสิทธิ์ส่งออกรายงาน'
      });
    }
  }

  const now = Date.now();
  let startTs = null;
  let endTs = null;
  if (startDate) {
    const [sy, sm, sd] = startDate.split('-').map(Number);
    startTs = new Date(sy, sm - 1, sd, 0, 0, 0, 0).getTime();
  }
  if (endDate) {
    const [ey, em, ed] = endDate.split('-').map(Number);
    endTs = new Date(ey, em - 1, ed, 23, 59, 59, 999).getTime();
  }

  // Format Thai dates (BE year + 543)
  function toThaiDateStr(d) {
    const date = d ? new Date(d) : new Date();
    return date.toLocaleDateString('th-TH', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Asia/Bangkok'
    });
  }

  const startDateThai = startDate
    ? toThaiDateStr(startTs)
    : (endDate ? toThaiDateStr(endTs) : '-');

  const endDateThai = endDate
    ? toThaiDateStr(endTs)
    : (startDate ? toThaiDateStr(startTs) : toThaiDateStr(now));

  const fileDateTag = (startDate && endDate)
    ? `${startDate}_to_${endDate}`
    : (startDate || endDate || new Date().toISOString().split('T')[0]);

  // Query logs for the selected range if range is specified
  let logsForExport = [];
  if (startTs !== null && endTs !== null) {
    logsForExport = dbStorage.getAttendanceLogsByDateRange(startTs, endTs);
  } else if (startTs !== null) {
    logsForExport = dbStorage.getAttendanceLogsByDateRange(startTs, Date.now());
  } else if (endTs !== null) {
    logsForExport = dbStorage.getAttendanceLogsByDateRange(0, endTs);
  } else {
    logsForExport = db.attendanceLogs ? db.attendanceLogs.slice(0, 500) : [];
  }

  // Prepare Timesheet Data
  const timesheetData = db.users.map((u, idx) => {
    const att = u.attendance || { status: 'not_checked_in', location: 'WFH' };

    const workDate = att.checkInTimestamp
      ? toThaiDateStr(att.checkInTimestamp)
      : toThaiDateStr(now);

    let hoursStr = '-';
    if (att.checkInTimestamp) {
      const endTsAtt = att.checkOutTimestamp || now;
      const diffMs = Math.max(0, endTsAtt - att.checkInTimestamp);
      const mins = Math.floor(diffMs / 60000);
      const hrs = Math.floor(mins / 60);
      hoursStr = `${hrs} ชม. ${mins % 60} นาที`;
    }

    let attStatusThai = 'ยังไม่ลงเวลา';
    if (att.status === 'checked_in') attStatusThai = 'เข้างานแล้ว';
    else if (att.status === 'checked_out') attStatusThai = 'ออกงานแล้ว';

    let sysStatusThai = 'ออฟไลน์';
    if (u.status === 'available') sysStatusThai = 'พร้อมทำงาน';
    else if (u.status === 'busy') sysStatusThai = 'ติดภารกิจ';
    else if (u.status === 'away') sysStatusThai = 'พักเบรก';
    else if (u.status === 'leave') sysStatusThai = 'ลาพักผ่อน';

    return {
      'ลำดับ': idx + 1,
      'ตั้งแต่วันที่': startDateThai,
      'ถึงวันที่': endDateThai,
      'วันที่ปฏิบัติงาน': workDate,
      'รหัสพนักงาน': u.empCode || '-',
      'ชื่อ - สกุล': u.name,
      'ชื่อเล่น': u.nickname || '-',
      'ตำแหน่ง': u.role || '-',
      'ฝ่ายงาน / สำนัก': u.department || '-',
      'สถานที่ปฏิบัติงาน': att.location || 'WFH',
      'เวลาเข้างาน': att.checkInTime ? `${att.checkInTime} น.` : '-',
      'เวลาออกงาน': att.checkOutTime ? `${att.checkOutTime} น.` : '-',
      'รวมเวลาปฏิบัติงาน': hoursStr,
      'สถานะการลงเวลา': attStatusThai,
      'สถานะในระบบ': sysStatusThai,
      'สิทธิ์': u.isAdmin ? 'ผู้ดูแลระบบ (Admin)' : (u.isHR ? 'เจ้าหน้าที่ HR' : 'พนักงานทั่วไป'),
      'หมายเหตุ': att.note || '-'
    };
  });

  // Prepare Action Logs Data
  const logsData = logsForExport.map((log, idx) => {
    const u = db.users.find(usr => usr.id === log.userId) || {};
    const logDate = toThaiDateStr(log.timestamp || now);
    const dateFormatted = new Date(log.timestamp || now).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    return {
      'ลำดับ': idx + 1,
      'ตั้งแต่วันที่': startDateThai,
      'ถึงวันที่': endDateThai,
      'วันที่ปฏิบัติงาน': logDate,
      'รหัสบันทึก': log.id,
      'รหัสพนักงาน': u.empCode || '-',
      'ชื่อผู้ปฏิบัติงาน': log.userName,
      'ฝ่ายงาน': u.department || '-',
      'การกระทำ': log.action === 'check_in' ? 'เข้างาน (Check-In)' : 'ออกงาน (Check-Out)',
      'สถานที่': log.location || 'WFH',
      'เวลา': `${log.time} น.`,
      'วันเวลาที่บันทึก': dateFormatted,
      'หมายเหตุ': log.note || '-'
    };
  });

  if (format === 'csv') {
    // Generate CSV with UTF-8 BOM for Thai Excel compatibility
    const headers = Object.keys(timesheetData[0] || {});
    let csv = '\uFEFF' + headers.join(',') + '\n';
    timesheetData.forEach(row => {
      const line = headers.map(h => {
        const val = row[h] === undefined || row[h] === null ? '' : String(row[h]);
        return `"${val.replace(/"/g, '""')}"`;
      }).join(',');
      csv += line + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="FMO_Attendance_${fileDateTag}.csv"`);
    return res.send(csv);
  }

  // Default: XLSX
  const wb = XLSX.utils.book_new();

  // Sheet 1: Timesheet
  const wsTimesheet = XLSX.utils.json_to_sheet(timesheetData);
  wsTimesheet['!cols'] = [
    { wch: 8 },  // ลำดับ
    { wch: 16 }, // ตั้งแต่วันที่
    { wch: 16 }, // ถึงวันที่
    { wch: 16 }, // วันที่ปฏิบัติงาน
    { wch: 14 }, // รหัสพนักงาน
    { wch: 28 }, // ชื่อ - สกุล
    { wch: 12 }, // ชื่อเล่น
    { wch: 32 }, // ตำแหน่ง
    { wch: 35 }, // ฝ่ายงาน
    { wch: 18 }, // สถานที่
    { wch: 14 }, // เวลาเข้า
    { wch: 14 }, // เวลาออก
    { wch: 18 }, // รวมเวลา
    { wch: 16 }, // สถานะลงเวลา
    { wch: 14 }, // สถานะระบบ
    { wch: 20 }, // สิทธิ์
    { wch: 30 }  // หมายเหตุ
  ];
  XLSX.utils.book_append_sheet(wb, wsTimesheet, 'สรุปการลงเวลา Timesheet');

  // Sheet 2: Action Logs
  if (logsData.length > 0) {
    const wsLogs = XLSX.utils.json_to_sheet(logsData);
    wsLogs['!cols'] = [
      { wch: 8 },  // ลำดับ
      { wch: 16 }, // ตั้งแต่วันที่
      { wch: 16 }, // ถึงวันที่
      { wch: 16 }, // วันที่ปฏิบัติงาน
      { wch: 22 }, // รหัสบันทึก
      { wch: 14 }, // รหัสพนักงาน
      { wch: 28 }, // ชื่อ
      { wch: 35 }, // ฝ่ายงาน
      { wch: 20 }, // การกระทำ
      { wch: 14 }, // สถานที่
      { wch: 12 }, // เวลา
      { wch: 24 }, // วันเวลาที่บันทึก
      { wch: 30 }  // หมายเหตุ
    ];
    XLSX.utils.book_append_sheet(wb, wsLogs, 'ประวัติการกดเวลา (Logs)');
  }

  const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="FMO_Attendance_${fileDateTag}.xlsx"`);
  return res.send(xlsxBuffer);
});

// Clock in by Employee Code (รหัสพนักงาน)
app.post('/api/attendance/clock-in-by-code', (req, res) => {
  const { empCode, location, note } = req.body;
  const cleanCode = (empCode || '').trim();
  if (!cleanCode) return res.status(400).json({ error: 'กรุณากรอกรหัสพนักงาน' });

  const user = db.users.find(u => 
    u.empCode === cleanCode || 
    u.empCode === cleanCode.padStart(8, '0') || 
    (cleanCode.length >= 3 && u.empCode.endsWith(cleanCode)) ||
    u.name.includes(cleanCode)
  );
  if (!user) return res.status(404).json({ error: 'ไม่พบรหัสพนักงานนี้ในระบบ' });

  const now = Date.now();
  const timeStr = getBangkokTimeStr();
  user.attendance = {
    status: 'checked_in',
    location: location || 'WFH',
    checkInTime: timeStr,
    checkInTimestamp: now,
    checkOutTime: null,
    checkOutTimestamp: null,
    note: note || `ลงเวลาเข้างาน ${location || 'WFH'} ด้วยรหัสพนักงาน`
  };
  user.status = 'available';
  user.statusChangedAt = now;
  user.lastHeartbeat = now;
  user.note = `เข้างานแล้ว (${user.attendance.location}) พร้อมทำงาน 💻`;

  const attLog = {
    id: `att-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    userId: user.id,
    userName: user.name,
    action: 'check_in',
    location: user.attendance.location,
    time: timeStr,
    timestamp: now,
    note: note || 'ลงเวลาด้วยรหัสพนักงาน'
  };
  if (!db.attendanceLogs) db.attendanceLogs = [];
  db.attendanceLogs.unshift(attLog);
  if (db.attendanceLogs.length > 100) db.attendanceLogs.pop();

  const actLog = {
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    userId: user.id,
    userName: user.name,
    type: 'attendance_checkin',
    fromStatus: 'offline',
    toStatus: 'available',
    note: `ลงเวลาเข้างาน ${timeStr} (${user.attendance.location}) [รหัส: ${user.empCode}]`,
    timestamp: now
  };
  db.activityLogs.unshift(actLog);
  if (db.activityLogs.length > 50) db.activityLogs.pop();

  saveDB();
  broadcast({ type: 'ATTENDANCE_UPDATED', user, attendanceLog: attLog, activityLog: actLog, clockedInByCode: true });
  res.json({ success: true, user, timeStr });
});

// Search user by employee code or name
app.get('/api/user-by-code/:code', (req, res) => {
  const code = (req.params.code || '').trim();
  const user = db.users.find(u => 
    u.empCode === code || 
    u.empCode === code.padStart(8, '0') || 
    (code.length >= 3 && u.empCode.endsWith(code)) ||
    u.name.includes(code)
  );
  if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้งาน' });
  res.json({ success: true, user });
});

// Update personal profile
app.post('/api/user/profile', (req, res) => {
  const { userId, avatar, name, nickname, role, department, phone, email } = req.body;
  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้งานในระบบ' });

  const cleanName = (name || '').trim();
  const cleanNick = (nickname || '').trim();
  const cleanRole = (role || '').trim();
  const cleanDept = (department || '').trim();
  const cleanPhone = (phone || '').trim();
  const cleanEmail = (email || '').trim();

  if (!cleanName || !cleanNick || !cleanRole || !cleanDept || !cleanPhone || !cleanEmail) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบทุกช่องที่มีเครื่องหมายดอกจันสีแดง (*)' });
  }

  if (avatar && avatar.startsWith('data:image/')) {
    user.avatar = dbStorage.saveAvatarFile(user.empCode || user.id, avatar);
  } else if (avatar) {
    user.avatar = avatar;
  }
  user.name = cleanName;
  user.nickname = cleanNick;
  user.role = cleanRole;
  user.department = cleanDept;
  user.phone = cleanPhone;
  user.email = cleanEmail;

  const now = Date.now();
  const actLog = {
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    userId: user.id,
    userName: user.name,
    type: 'profile_updated',
    fromStatus: user.status,
    toStatus: user.status,
    note: `อัปเดตข้อมูลส่วนตัวและรูปโปรไฟล์สำเร็จ`,
    timestamp: now
  };
  db.activityLogs.unshift(actLog);
  if (db.activityLogs.length > 50) db.activityLogs.pop();

  saveDB(user);
  broadcast({ type: 'PROFILE_UPDATED', user, activityLog: actLog });
  res.json({ success: true, user });
});

app.post('/api/attendance/checkin', (req, res) => {
  const { userId, location, note } = req.body;
  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const now = Date.now();
  const timeStr = getBangkokTimeStr();
  user.attendance = {
    status: 'checked_in',
    location: location || 'WFH',
    checkInTime: timeStr,
    checkInTimestamp: now,
    checkOutTime: null,
    checkOutTimestamp: null,
    note: note || ''
  };
  user.status = 'available';
  user.statusChangedAt = now;
  user.lastHeartbeat = now;
  user.note = `เข้างานแล้ว (${user.attendance.location}) พร้อมทำงาน 💻`;

  saveDB();
  broadcast({ type: 'ATTENDANCE_UPDATED', user });
  res.json({ success: true, user });
});

app.post('/api/attendance/checkout', (req, res) => {
  const { userId, note } = req.body;
  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const now = Date.now();
  const timeStr = getBangkokTimeStr();
  if (!user.attendance) user.attendance = { status: 'not_checked_in' };
  user.attendance.status = 'checked_out';
  user.attendance.checkOutTime = timeStr;
  user.attendance.checkOutTimestamp = now;
  user.status = 'offline';
  user.statusChangedAt = now;
  user.note = `เลิกงานแล้ว (${timeStr}) 👋`;

  saveDB();
  broadcast({ type: 'ATTENDANCE_UPDATED', user });
  res.json({ success: true, user });
});

app.post('/api/reset-demo', (req, res) => {
  db.users = generateSeedUsers();
  db.activityLogs = JSON.parse(JSON.stringify(defaultActivityLogs));
  db.attendanceLogs = JSON.parse(JSON.stringify(defaultAttendanceLogs));
  saveDB();
  broadcast({
    type: 'INIT',
    users: db.users,
    logs: db.activityLogs,
    attendanceLogs: db.attendanceLogs,
    serverTime: Date.now()
  });
  res.json({ success: true, message: 'Demo data reset successfully (94 members seeded)' });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 TimeOn WFH Status & Attendance running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server active on ws://localhost:${PORT}/ws`);
  console.log(`=======================================================`);
});
