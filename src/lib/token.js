function encodeToken(data) {
  const jsonStr = JSON.stringify(data);
  return Buffer.from(jsonStr, 'utf8').toString('base64url');
}

function decodeToken(token) {
  try {
    const jsonStr = Buffer.from(token, 'base64url').toString('utf8');
    return JSON.parse(jsonStr);
  } catch (err) {
    throw new Error('Invalid subtitle token');
  }
}

module.exports = {
  encodeToken,
  decodeToken,
};
