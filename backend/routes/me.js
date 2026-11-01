// Customer account extras (signed in).
//
//   GET /api/me/medipoints → MediPoints balance, lifetime total and recent entries
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../lib/errors');
const { pointsSummary } = require('../lib/medipoints');

const router = express.Router();

router.use(requireAuth);

// GET /api/me/medipoints
router.get(
  '/medipoints',
  asyncHandler(async (req, res) => {
    res.json(await pointsSummary(req.user._id));
  })
);

module.exports = router;
