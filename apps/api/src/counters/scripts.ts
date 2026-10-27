/*
 * KEYS (see scriptKeys): 1 init, 2 spent, 3 count, 4 cards, 5 cardrefs,
 *                        6 daySpent, 7 dayCount, 8 cardCount, 9 cardAmount
 * Limits of -1 mean unlimited.
 */

/** ARGV: 1 discount, 2 cardHash, 3 totalBudget, 4 maxCards, 5 dailyBudget, 6 dailyCount,
 *        7 perCardCount, 8 perCardAmount, 9 campaignTtl, 10 dayTtl, 11 cardTtl */
export const RESERVE_LUA = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 'NOT_INITIALIZED' end
local d = tonumber(ARGV[1])
local function num(k) return tonumber(redis.call('GET', k) or '0') end
local function over(limit, value) local l = tonumber(limit) return l >= 0 and value > l end

if over(ARGV[3], num(KEYS[2]) + d) then return 'BUDGET_EXHAUSTED' end
local isMember = redis.call('SISMEMBER', KEYS[4], ARGV[2]) == 1
if not isMember and over(ARGV[4], redis.call('SCARD', KEYS[4]) + 1) then return 'MAX_CARDS_REACHED' end
if over(ARGV[5], num(KEYS[6]) + d) then return 'DAILY_BUDGET_EXHAUSTED' end
if over(ARGV[6], num(KEYS[7]) + 1) then return 'DAILY_LIMIT_REACHED' end
if over(ARGV[7], num(KEYS[8]) + 1) then return 'CARD_LIMIT_REACHED' end
if over(ARGV[8], num(KEYS[9]) + d) then return 'CARD_AMOUNT_LIMIT_REACHED' end

redis.call('INCRBY', KEYS[2], d)
redis.call('INCR', KEYS[3])
redis.call('SADD', KEYS[4], ARGV[2])
redis.call('HINCRBY', KEYS[5], ARGV[2], 1)
redis.call('INCRBY', KEYS[6], d)
redis.call('INCR', KEYS[7])
redis.call('INCR', KEYS[8])
redis.call('INCRBY', KEYS[9], d)
for i = 2, 5 do redis.call('EXPIRE', KEYS[i], ARGV[9]) end
redis.call('EXPIRE', KEYS[6], ARGV[10])
redis.call('EXPIRE', KEYS[7], ARGV[10])
redis.call('EXPIRE', KEYS[8], ARGV[11])
redis.call('EXPIRE', KEYS[9], ARGV[11])
return 'OK'
`;

/**
 * ARGV: 1 discountDelta (amount to give back), 2 cardHash, 3 releaseUsage (1 = also free the
 * redemption's count and card slot, used on cancel/expiry/full refund).
 * No-op if the campaign is not initialised: a rebuild reads Postgres, which already has the change.
 * Bucket keys that already expired are left alone.
 */
export const RELEASE_LUA = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 'NOT_INITIALIZED' end
local d = tonumber(ARGV[1])
local function dec(k, by) if redis.call('EXISTS', k) == 1 then redis.call('DECRBY', k, by) end end

dec(KEYS[2], d)
dec(KEYS[6], d)
dec(KEYS[9], d)
if ARGV[3] == '1' then
  dec(KEYS[3], 1)
  dec(KEYS[7], 1)
  dec(KEYS[8], 1)
  if redis.call('HINCRBY', KEYS[5], ARGV[2], -1) <= 0 then
    redis.call('HDEL', KEYS[5], ARGV[2])
    redis.call('SREM', KEYS[4], ARGV[2])
  end
end
return 'OK'
`;
