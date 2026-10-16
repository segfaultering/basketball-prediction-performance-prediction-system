"""Application failures translated by the HTTP and command-line interfaces."""


class ApplicationError(ValueError):
    status_code = 422


class NotFoundError(ApplicationError):
    status_code = 404


class PregameError(ApplicationError):
    status_code = 409
