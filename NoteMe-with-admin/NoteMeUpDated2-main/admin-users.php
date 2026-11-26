<?php
declare(strict_types=1);
session_start();
header('Content-Type: application/json');

// Server-side guard: only a logged-in admin may list customers.
if (($_SESSION['user']['role'] ?? null) !== 'admin') {
    http_response_code(403);
    echo json_encode(['ok' => false, 'message' => 'Admin access required.']);
    exit;
}

require_once 'db.php';

// Never select password_hash.
$stmt = $pdo->query('SELECT id, username, name, age, email, address, role FROM users ORDER BY id DESC');
echo json_encode(['ok' => true, 'users' => $stmt->fetchAll()]);
