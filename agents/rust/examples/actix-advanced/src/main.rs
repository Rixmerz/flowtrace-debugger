//! Advanced Actix-Web example with FlowTrace integration
//!
//! Demonstrates:
//! - Automatic tracing with #[trace] macro
//! - Manual span creation and tagging
//! - Error handling and logging
//! - Database simulation with latency
//! - CRUD operations

use actix_web::{web, App, HttpResponse, HttpServer, Responder};
use flowtrace_agent::{middleware::actix::FlowTraceMiddleware, span::start_span, Config};
use flowtrace_derive::trace;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

// User model
#[derive(Debug, Clone, Serialize, Deserialize)]
struct User {
    id: u32,
    name: String,
    email: String,
    created_at: String,
}

// Database simulation
struct Database {
    users: Arc<Mutex<HashMap<u32, User>>>,
}

impl Database {
    fn new() -> Self {
        let mut users = HashMap::new();
        users.insert(
            1,
            User {
                id: 1,
                name: "Alice".to_string(),
                email: "alice@example.com".to_string(),
                created_at: chrono::Utc::now().to_rfc3339(),
            },
        );
        users.insert(
            2,
            User {
                id: 2,
                name: "Bob".to_string(),
                email: "bob@example.com".to_string(),
                created_at: chrono::Utc::now().to_rfc3339(),
            },
        );

        Self {
            users: Arc::new(Mutex::new(users)),
        }
    }

    #[trace]
    async fn get_user(&self, id: u32) -> Option<User> {
        // Simulate database latency
        tokio::time::sleep(Duration::from_millis(20)).await;

        let users = self.users.lock().unwrap();
        users.get(&id).cloned()
    }

    #[trace]
    async fn create_user(&self, mut user: User) -> User {
        // Simulate database latency
        tokio::time::sleep(Duration::from_millis(30)).await;

        let mut users = self.users.lock().unwrap();
        let id = users.len() as u32 + 1;
        user.id = id;
        user.created_at = chrono::Utc::now().to_rfc3339();
        users.insert(id, user.clone());
        user
    }

    #[trace]
    async fn list_users(&self) -> Vec<User> {
        tokio::time::sleep(Duration::from_millis(15)).await;

        let users = self.users.lock().unwrap();
        users.values().cloned().collect()
    }
}

// Application state
struct AppState {
    db: Database,
}

// Health check endpoint
#[trace]
async fn health() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "timestamp": chrono::Utc::now().to_rfc3339(),
    }))
}

// Get user by ID
#[trace]
async fn get_user(path: web::Path<u32>, data: web::Data<AppState>) -> impl Responder {
    let mut span = start_span(module_path!(), "get_user_handler");
    let user_id = path.into_inner();

    span.set_tag("user_id", user_id);

    // Query database
    let db_span = start_span(module_path!(), "database_get_user");
    let user = data.db.get_user(user_id).await;
    drop(db_span);

    match user {
        Some(user) => {
            span.set_tag("user_found", "true");
            span.end();
            HttpResponse::Ok().json(user)
        }
        None => {
            span.set_tag("user_found", "false");
            span.set_error("User not found");
            span.end();
            HttpResponse::NotFound().json(serde_json::json!({
                "error": "User not found"
            }))
        }
    }
}

// Create new user
#[derive(Deserialize)]
struct CreateUserRequest {
    name: String,
    email: String,
}

#[trace]
async fn create_user(
    req: web::Json<CreateUserRequest>,
    data: web::Data<AppState>,
) -> impl Responder {
    let mut span = start_span(module_path!(), "create_user_handler");

    span.set_tag("user_name", &req.name)
        .set_tag("user_email", &req.email);

    // Validate request
    let validation_span = start_span(module_path!(), "validate_user");
    if req.name.is_empty() || req.email.is_empty() {
        validation_span.end();
        span.set_error("Validation failed: name and email are required");
        span.end();

        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "Name and email are required"
        }));
    }
    validation_span.end();

    // Create user in database
    let user = User {
        id: 0, // Will be set by database
        name: req.name.clone(),
        email: req.email.clone(),
        created_at: String::new(),
    };

    let db_span = start_span(module_path!(), "database_create_user");
    let created_user = data.db.create_user(user).await;
    drop(db_span);

    span.set_tag("created_user_id", created_user.id);
    span.end();

    HttpResponse::Created().json(created_user)
}

// List all users
#[trace]
async fn list_users(data: web::Data<AppState>) -> impl Responder {
    let mut span = start_span(module_path!(), "list_users_handler");

    let db_span = start_span(module_path!(), "database_list_users");
    let users = data.db.list_users().await;
    drop(db_span);

    span.set_tag("total_users", users.len());
    span.end();

    HttpResponse::Ok().json(users)
}

// Get user profile (multi-span operation)
#[trace]
async fn get_user_profile(path: web::Path<u32>, data: web::Data<AppState>) -> impl Responder {
    let mut span = start_span(module_path!(), "get_user_profile_handler");
    let user_id = path.into_inner();

    span.set_tag("user_id", user_id);

    // Get user
    let user_span = start_span(module_path!(), "fetch_user");
    let user = data.db.get_user(user_id).await;
    drop(user_span);

    if user.is_none() {
        span.set_error("User not found");
        span.end();
        return HttpResponse::NotFound().json(serde_json::json!({
            "error": "User not found"
        }));
    }

    let user = user.unwrap();

    // Simulate external API call for profile enrichment
    let api_span = start_span(module_path!(), "external_api_call");
    api_span.set_tag("api", "profile_enrichment");
    tokio::time::sleep(Duration::from_millis(50)).await;
    drop(api_span);

    // Build enriched profile
    let profile = serde_json::json!({
        "user": user,
        "profile_views": 123,
        "last_active": chrono::Utc::now().to_rfc3339(),
        "badges": vec!["verified", "premium"],
    });

    span.set_tag("profile_enriched", "true");
    span.end();

    HttpResponse::Ok().json(profile)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Initialize FlowTrace
    let config = Config::default();
    flowtrace_agent::start_tracing(config).expect("Failed to start tracing");

    println!("🦀 Starting Actix-Web server with FlowTrace tracing...");
    println!("📊 Traces will be written to: flowtrace.jsonl");
    println!("🌐 Server running at: http://127.0.0.1:8080");
    println!();
    println!("Available endpoints:");
    println!("  GET  /health");
    println!("  GET  /users");
    println!("  GET  /users/:id");
    println!("  POST /users");
    println!("  GET  /users/:id/profile");

    // Initialize application state
    let app_state = web::Data::new(AppState {
        db: Database::new(),
    });

    // Start HTTP server
    HttpServer::new(move || {
        App::new()
            .app_data(app_state.clone())
            .wrap(FlowTraceMiddleware)
            .route("/health", web::get().to(health))
            .route("/users", web::get().to(list_users))
            .route("/users", web::post().to(create_user))
            .route("/users/{id}", web::get().to(get_user))
            .route("/users/{id}/profile", web::get().to(get_user_profile))
    })
    .bind(("127.0.0.1", 8080))?
    .run()
    .await
}
