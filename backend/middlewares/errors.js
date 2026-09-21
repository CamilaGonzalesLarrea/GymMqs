class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
class BadRequestException extends HttpError { constructor(message) { super(400, message); } }
class NotFoundException extends HttpError { constructor(message) { super(404, message); } }
function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let status = error instanceof HttpError ? error.status : 500;
  let message = status === 500 ? 'Internal server error' : error.message;
  if (error.type === 'entity.parse.failed') { status = 400; message = 'JSON inválido'; }
  if (error.type === 'entity.too.large') { status = 413; message = 'Cuerpo de solicitud demasiado grande'; }
  if (error.code === 'ER_DUP_ENTRY') { status = 409; message = 'Ya existe un registro con esos datos únicos'; }
  if (error.code === 'ER_NO_REFERENCED_ROW_2') { status = 400; message = 'El registro relacionado no existe'; }
  if (error.code === 'ER_ROW_IS_REFERENCED_2') { status = 409; message = 'El registro tiene datos relacionados'; }
  if (status === 500) console.error('Error de backend:', error.code || error.name || 'Error');
  const labels = {400:'Bad Request',404:'Not Found',409:'Conflict',413:'Payload Too Large'};
  const body = {message, ...(labels[status] ? {error:labels[status]} : {}), statusCode:status};
  res.status(status).json(req.path.startsWith('/api/auth/') ? {message} : body);
}
module.exports = {HttpError, BadRequestException, NotFoundException, errorHandler};
