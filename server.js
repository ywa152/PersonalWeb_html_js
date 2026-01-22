const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// 创建express应用
const app = express();
const port = 8888;

// 配置中间件
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 优化静态文件服务配置
// 1. 优先处理uploads目录的静态资源，支持视频流
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    // 设置缓存和视频流支持
    setHeaders: (res, path) => {
        if (path.endsWith('.mp4')) {
            // 视频支持
            res.setHeader('Accept-Ranges', 'bytes'); // 支持视频流传输
            res.setHeader('Content-Type', 'video/mp4'); // 明确设置视频MIME类型
            res.setHeader('Cache-Control', 'public, max-age=3600'); // 1小时缓存
        } else if (path.endsWith('.jpg') || path.endsWith('.png')) {
            // 图片支持
            res.setHeader('Cache-Control', 'public, max-age=3600'); // 1小时缓存
        }
    }
}));

// 2. 处理网站根目录的静态资源
app.use(express.static(path.join(__dirname)));

// 配置文件上传
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const mediaType = req.body.type === 'video' ? 'videos' : 'images';
        const mediaDir = path.join(uploadDir, mediaType);
        if (!fs.existsSync(mediaDir)) {
            fs.mkdirSync(mediaDir, { recursive: true });
        }
        cb(null, mediaDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const upload = multer({ storage });


// 创建数据库连接池
const db = mysql.createPool({
    host: 'localhost',
    user: 'ITKeillerWA',
    password: 'ywa152918..',
    database: 'itkeillerwa',
    port: 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // 连接池重连配置
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    // 处理连接错误
    charset: 'utf8mb4'
});

// 测试连接并创建表
function testConnection() {
    db.getConnection((err, connection) => {
        if (err) {
            console.error('数据库连接失败:', err);
            console.log('服务器将在没有数据库连接的情况下运行，部分功能可能受限');
            // 1秒后重试连接
            setTimeout(testConnection, 1000);
            return;
        }
        
        console.log('成功连接到MySQL数据库');
        connection.release();
        
        // 创建数据库表
        createTables();
    });
}

// 启动连接测试
testConnection();

// 连接池全局错误处理
db.on('error', (err) => {
    console.error('数据库连接池错误:', err.code);
    // 处理常见的连接错误
    if (err.code === 'PROTOCOL_CONNECTION_LOST' || 
        err.code === 'ECONNRESET' || 
        err.code === 'ETIMEDOUT' ||
        err.code === 'ECONNREFUSED') {
        console.error('数据库连接丢失，正在重新连接...');
        // 重新测试连接
        testConnection();
    }
});

// 创建数据库表
function createTables() {
    // 用户表
    const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        reason TEXT,
        approved BOOLEAN DEFAULT TRUE,
        registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_admin BOOLEAN DEFAULT FALSE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    
    // 媒体表
    const createMediaTable = `
    CREATE TABLE IF NOT EXISTS media (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        type ENUM('image', 'video') NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        thumbnail_path VARCHAR(255),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    
    // 访问量统计表
    const createStatsTable = `
    CREATE TABLE IF NOT EXISTS stats (
        id INT AUTO_INCREMENT PRIMARY KEY,
        page VARCHAR(255) NOT NULL,
        visit_count INT DEFAULT 0,
        visit_date DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    
    // 执行创建表语句
    db.query(createUsersTable, (err) => {
        if (err) {
            console.error('创建用户表失败:', err);
            return;
        }
        console.log('用户表创建成功');
        
        db.query(createMediaTable, (err) => {
            if (err) {
                console.error('创建媒体表失败:', err);
                return;
            }
            console.log('媒体表创建成功');
            
            db.query(createStatsTable, (err) => {
                if (err) {
                    console.error('创建访问量表失败:', err);
                    return;
                }
                console.log('访问量表创建成功');
                
                // 初始化访问量数据
                initializeStats();
            });
        });
    });
}

// 初始化访问量数据
function initializeStats() {
    const pages = ['index', 'self-media'];
    
    pages.forEach(page => {
        // 获取当前日期
        const today = new Date().toISOString().split('T')[0];
        
        db.query('SELECT * FROM stats WHERE page = ? AND visit_date = ?', [page, today], (err, result) => {
            if (err) {
                console.error('查询访问量失败:', err);
                return;
            }
            
            if (result.length === 0) {
                // 插入初始数据
                db.query(
                    'INSERT INTO stats (page, visit_count, visit_date) VALUES (?, ?, ?)',
                    [page, 0, today],
                    (err) => {
                        if (err) {
                            console.error('初始化访问量失败:', err);
                        }
                    }
                );
            }
        });
    });
}

// API路由

// 用户注册
app.post('/api/register', async (req, res) => {
    try {
        const { email, password, name, reason } = req.body;
        
        // 检查邮箱是否已存在
        const checkEmail = await new Promise((resolve, reject) => {
            db.query('SELECT * FROM users WHERE email = ?', [email], (err, result) => {
                if (err) reject(err);
                resolve(result);
            });
        });
        
        if (checkEmail.length > 0) {
            return res.status(400).json({ message: '该邮箱已注册' });
        }
        
        // 加密密码
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // 插入用户数据
        const insertUser = await new Promise((resolve, reject) => {
            db.query(
                'INSERT INTO users (email, password, name, reason) VALUES (?, ?, ?, ?)',
                [email, hashedPassword, name, reason || '无特殊说明'],
                (err, result) => {
                    if (err) reject(err);
                    resolve(result);
                }
            );
        });
        
        // 返回成功响应
        res.status(201).json({
            message: '注册成功',
            user: {
                id: insertUser.insertId,
                email,
                name,
                reason: reason || '无特殊说明',
                approved: true,
                is_admin: email === '1513019038@qq.com' // 管理员邮箱
            }
        });
    } catch (error) {
        console.error('注册错误:', error);
        res.status(500).json({ message: '注册失败', error: error.message });
    }
});

// 用户登录
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // 查询用户
        const getUser = await new Promise((resolve, reject) => {
            db.query('SELECT * FROM users WHERE email = ?', [email], (err, result) => {
                if (err) reject(err);
                resolve(result);
            });
        });
        
        if (getUser.length === 0) {
            return res.status(400).json({ message: '用户未注册' });
        }
        
        const user = getUser[0];
        
        // 验证密码
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ message: '密码错误' });
        }
        
        // 返回成功响应
        res.status(200).json({
            message: '登录成功',
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                is_admin: user.is_admin || user.email === '1513019038@qq.com'
            }
        });
    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ message: '登录失败', error: error.message });
    }
});

// 获取当前用户信息
app.get('/api/user', (req, res) => {
    // 注意：在实际项目中，应该使用session或JWT验证用户身份
    // 这里为了简化，直接返回模拟数据
    res.status(200).json({ message: '获取用户信息成功', user: null });
});

// 上传媒体文件
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        const { user_id, title, description, type } = req.body;
        const file = req.file;
        
        if (!file) {
            return res.status(400).json({ message: '请选择文件' });
        }
        
        // 文件类型验证
        const fileType = file.mimetype.split('/')[0];
        if (type !== fileType) {
            return res.status(400).json({ message: `文件类型不匹配：您选择了"${type}"类型，但上传的是"${fileType}"文件` });
        }
        
        // 构建文件路径 - 确保使用正确的相对路径格式
        let relativePath = file.path.replace(__dirname + '\\', '').replace(/\\/g, '/');
        // 确保路径以uploads/开头，去掉可能的多余部分
        if (!relativePath.startsWith('uploads/')) {
            relativePath = 'uploads/' + relativePath.replace(/^.*[\\/](uploads[\\/])?/, '');
        }
        
        // 获取封面图路径
                const thumbnailPath = req.body.thumbnail_path || null;
                
                // 插入媒体数据
                const insertMedia = await new Promise((resolve, reject) => {
                    db.query(
                        'INSERT INTO media (user_id, title, description, type, file_path, thumbnail_path) VALUES (?, ?, ?, ?, ?, ?)',
                        [user_id, title, description || '无描述', type, relativePath, thumbnailPath],
                        (err, result) => {
                            if (err) reject(err);
                            resolve(result);
                        }
                    );
                });
                
                // 返回成功响应
                res.status(201).json({
                    message: '上传成功',
                    media: {
                        id: insertMedia.insertId,
                        user_id,
                        title,
                        description: description || '无描述',
                        type,
                        file_path: relativePath,
                        thumbnail_path: thumbnailPath,
                        created_at: new Date().toISOString()
                    }
                });
    } catch (error) {
        console.error('上传错误:', error);
        res.status(500).json({ message: '上传失败', error: error.message });
    }
});

// 获取媒体列表
app.get('/api/media', (req, res) => {
    try {
        const { type } = req.query;
        let query = 'SELECT * FROM media ORDER BY created_at DESC';
        let params = [];
        
        if (type) {
            query = 'SELECT * FROM media WHERE type = ? ORDER BY created_at DESC';
            params = [type];
        }
        
        db.query(query, params, (err, results) => {
            if (err) {
                console.error('获取媒体列表错误:', err);
                return res.status(500).json({ message: '获取媒体列表失败', error: err.message });
            }
            
            res.status(200).json({
                message: '获取媒体列表成功',
                media: results
            });
        });
    } catch (error) {
        console.error('获取媒体列表错误:', error);
        res.status(500).json({ message: '获取媒体列表失败', error: error.message });
    }
});

// 获取单个媒体
app.get('/api/media/:id', (req, res) => {
    try {
        const { id } = req.params;
        
        db.query('SELECT * FROM media WHERE id = ?', [id], (err, results) => {
            if (err) {
                console.error('获取媒体错误:', err);
                return res.status(500).json({ message: '获取媒体失败', error: err.message });
            }
            
            if (results.length === 0) {
                return res.status(404).json({ message: '媒体不存在' });
            }
            
            res.status(200).json({
                message: '获取媒体成功',
                media: results[0]
            });
        });
    } catch (error) {
        console.error('获取媒体错误:', error);
        res.status(500).json({ message: '获取媒体失败', error: error.message });
    }
});

// 更新访问量
app.post('/api/update-stats', (req, res) => {
    try {
        const { page } = req.body;
        
        if (!page) {
            return res.status(400).json({ message: '请提供页面名称' });
        }
        
        // 获取当前日期
        const today = new Date().toISOString().split('T')[0];
        
        // 检查今天是否已有记录
        db.query(
            'SELECT * FROM stats WHERE page = ? AND visit_date = ?',
            [page, today],
            (err, result) => {
                if (err) {
                    console.error('查询访问量记录失败:', err);
                    return res.status(500).json({ message: '更新访问量失败', error: err.message });
                }
                
                if (result.length > 0) {
                    // 更新现有记录
                    db.query(
                        'UPDATE stats SET visit_count = visit_count + 1 WHERE page = ? AND visit_date = ?',
                        [page, today],
                        (err) => {
                            if (err) {
                                console.error('更新访问量失败:', err);
                                return res.status(500).json({ message: '更新访问量失败', error: err.message });
                            }
                            
                            res.status(200).json({ message: '访问量更新成功' });
                        }
                    );
                } else {
                    // 插入新记录
                    db.query(
                        'INSERT INTO stats (page, visit_count, visit_date) VALUES (?, ?, ?)',
                        [page, 1, today],
                        (err) => {
                            if (err) {
                                console.error('插入访问量记录失败:', err);
                                return res.status(500).json({ message: '更新访问量失败', error: err.message });
                            }
                            
                            res.status(200).json({ message: '访问量更新成功' });
                        }
                    );
                }
            }
        );
    } catch (error) {
        console.error('更新访问量错误:', error);
        res.status(500).json({ message: '更新访问量失败', error: error.message });
    }
});

// 获取访问量统计
app.get('/api/stats', (req, res) => {
    try {
        // 只获取自媒体空间的访问量，按日期分组统计
        const query = `
            SELECT 
                visit_date,
                SUM(visit_count) AS total_visits
            FROM stats 
            WHERE page = 'self-media' 
            GROUP BY visit_date 
            ORDER BY visit_date DESC 
            LIMIT 7
        `;
        
        db.query(query, (err, results) => {
            if (err) {
                console.error('获取访问量统计失败:', err);
                return res.status(200).json({
                    message: '获取访问量统计成功',
                    stats: {
                        totalVisits: 0,
                        pages: []
                    }
                });
            }
            
            // 计算总访问量
            const totalVisits = results.reduce((sum, stat) => sum + stat.total_visits, 0);
            
            res.status(200).json({
                message: '获取访问量统计成功',
                stats: {
                    totalVisits: totalVisits,
                    pages: results
                }
            });
        });
    } catch (error) {
        console.error('获取访问量统计错误:', error);
        res.status(200).json({
            message: '获取访问量统计成功',
            stats: {
                totalVisits: 0,
                pages: []
            }
        });
    }
});

// 获取新注册用户
app.get('/api/new-users', (req, res) => {
    try {
        // 获取所有注册用户，按注册时间倒序
        const query = `
            SELECT * FROM users 
            ORDER BY registered_at DESC
        `;
        
        db.query(query, (err, results) => {
            if (err) {
                console.error('获取新注册用户失败:', err);
                return res.status(500).json({ message: '获取新注册用户失败', error: err.message });
            }
            
            res.status(200).json({
                message: '获取新注册用户成功',
                users: results
            });
        });
    } catch (error) {
        console.error('获取新注册用户错误:', error);
        res.status(500).json({ message: '获取新注册用户失败', error: error.message });
    }
});

// 启动服务器
app.listen(port, () => {
    console.log(`服务器运行在 http://localhost:${port}`);
    console.log(`网站访问地址: http://localhost:${port}/index.html`);
    console.log(`自媒体空间: http://localhost:${port}/self-media.html`);
});