//! Actix-Web middleware for FlowTrace

use actix_web::{
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    Error, HttpMessage,
};
use futures_util::future::LocalBoxFuture;
use std::future::{ready, Ready};
use std::time::Instant;

use crate::{TraceEvent, log_event};

/// Actix-Web middleware for automatic request tracing
pub struct FlowTraceMiddleware;

impl<S, B> Transform<S, ServiceRequest> for FlowTraceMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type InitError = ();
    type Transform = FlowTraceMiddlewareService<S>;
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(FlowTraceMiddlewareService { service }))
    }
}

pub struct FlowTraceMiddlewareService<S> {
    service: S,
}

impl<S, B> Service<ServiceRequest> for FlowTraceMiddlewareService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let start_time = Instant::now();
        let method = req.method().to_string();
        let path = req.path().to_string();
        let module = "actix_web";

        // Log ENTER event
        log_event(TraceEvent::enter(
            module,
            &format!("{} {}", method, path),
            Some(format!(
                r#"{{"method":"{}","path":"{}","headers":{:?}}}"#,
                method,
                path,
                req.headers()
            )),
        ));

        let fut = self.service.call(req);

        Box::pin(async move {
            let res = fut.await?;
            let duration = start_time.elapsed().as_secs_f64() * 1000.0;

            // Log EXIT event
            log_event(TraceEvent::exit(
                module,
                &format!("{} {}", method, path),
                Some(format!(
                    r#"{{"status":{},"duration_ms":{:.2}}}"#,
                    res.status().as_u16(),
                    duration
                )),
                Some(duration),
            ));

            Ok(res)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test, web, App, HttpResponse};

    #[actix_web::test]
    async fn test_middleware() {
        let app = test::init_service(
            App::new()
                .wrap(FlowTraceMiddleware)
                .route("/test", web::get().to(|| async { HttpResponse::Ok().body("test") })),
        )
        .await;

        let req = test::TestRequest::get().uri("/test").to_request();
        let resp = test::call_service(&app, req).await;

        assert!(resp.status().is_success());
    }
}
