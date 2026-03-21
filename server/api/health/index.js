module.exports = async function (context, req) {
  context.log('Health check requested');

  context.res = {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: {
      status: 'ok',
      service: 'HTML to PPTX Converter',
      timestamp: new Date().toISOString()
    }
  };
};
