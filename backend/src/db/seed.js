require('dotenv').config();
const { query, pool } = require('./index');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

async function seed() {
    try {
        logger.info('Seeding database...');

        // Create admin user
        const hashedPassword = await bcrypt.hash('Admin@123', 12);
        await query(`
      INSERT INTO users (username, email, password_hash, role, rating)
      VALUES
        ('admin', 'admin@coderunner.io', $1, 'admin', 2500),
        ('setter1', 'setter@coderunner.io', $1, 'setter', 1800),
        ('alice', 'alice@example.com', $1, 'user', 1650),
        ('bob', 'bob@example.com', $1, 'user', 1420),
        ('charlie', 'charlie@example.com', $1, 'user', 1380)
      ON CONFLICT (email) DO NOTHING
    `, [hashedPassword]);

        // Get setter id
        const setterRes = await query(`SELECT id FROM users WHERE username='setter1'`);
        const setterId = setterRes.rows[0]?.id;

        // Seed problems
        const problems = [
            {
                title: 'Two Sum',
                slug: 'two-sum',
                description: `Given an array of integers \\\`nums\\\` and an integer \\\`target\\\`, return indices of the two numbers such that they add up to \\\`target\\\`.

You may assume that each input would have **exactly one solution**, and you may not use the same element twice.

You can return the answer in any order.

## Example 1
\\\`\\\`\\\`
Input: nums = [2,7,11,15], target = 9
Output: [0,1]
\\\`\\\`\\\`

## Example 2
\\\`\\\`\\\`
Input: nums = [3,2,4], target = 6
Output: [1,2]
\\\`\\\`\\\``,
                difficulty: 'Easy',
                tags: ['Array', 'Hash Table'],
                constraints: '2 <= nums.length <= 10^4\n-10^9 <= nums[i] <= 10^9\n-10^9 <= target <= 10^9',
                input_format: 'First line contains n and target. Second line contains n integers.',
                output_format: 'Two space-separated integers representing indices.',
                time_limit: 2000,
                memory_limit: 256,
            },
            {
                title: 'Reverse Linked List',
                slug: 'reverse-linked-list',
                description: `Given the head of a singly linked list, reverse the list, and return the reversed list.

## Example 1
\\\`\\\`\\\`
Input: head = [1,2,3,4,5]
Output: [5,4,3,2,1]
\\\`\\\`\\\`

## Example 2
\\\`\\\`\\\`
Input: head = [1,2]
Output: [2,1]
\\\`\\\`\\\``,
                difficulty: 'Easy',
                tags: ['Linked List', 'Recursion'],
                constraints: 'The number of nodes in the list is the range [0, 5000].',
                input_format: 'Space-separated integers representing linked list.',
                output_format: 'Space-separated integers of reversed list.',
                time_limit: 2000,
                memory_limit: 256,
            },
            {
                title: 'Longest Substring Without Repeating Characters',
                slug: 'longest-substring-without-repeating',
                description: `Given a string \\\`s\\\`, find the length of the **longest substring** without repeating characters.

## Example 1
\\\`\\\`\\\`
Input: s = "abcabcbb"
Output: 3
Explanation: The answer is "abc", with the length of 3.
\\\`\\\`\\\`

## Example 2
\\\`\\\`\\\`
Input: s = "bbbbb"
Output: 1
\\\`\\\`\\\``,
                difficulty: 'Medium',
                tags: ['Hash Table', 'String', 'Sliding Window'],
                constraints: '0 <= s.length <= 5 * 10^4',
                input_format: 'A single string s.',
                output_format: 'An integer representing the length.',
                time_limit: 2000,
                memory_limit: 256,
            },
            {
                title: 'Median of Two Sorted Arrays',
                slug: 'median-two-sorted-arrays',
                description: `Given two sorted arrays \\\`nums1\\\` and \\\`nums2\\\` of size m and n respectively, return the **median** of the two sorted arrays.

The overall run time complexity should be O(log (m+n)).

## Example 1
\\\`\\\`\\\`
Input: nums1 = [1,3], nums2 = [2]
Output: 2.00000
\\\`\\\`\\\``,
                difficulty: 'Hard',
                tags: ['Array', 'Binary Search', 'Divide and Conquer'],
                constraints: 'nums1.length == m\nnums2.length == n\n0 <= m <= 1000\n0 <= n <= 1000',
                input_format: 'Two lines each with space-separated integers.',
                output_format: 'A float with 5 decimal places.',
                time_limit: 2000,
                memory_limit: 256,
            },
            {
                title: 'Valid Parentheses',
                slug: 'valid-parentheses',
                description: `Given a string \\\`s\\\` containing just the characters '(', ')', '{', '}', '[' and ']', determine if the input string is valid.

An input string is valid if:
1. Open brackets must be closed by the same type of brackets.
2. Open brackets must be closed in the correct order.

## Example
\\\`\\\`\\\`
Input: s = "()[]{}"
Output: true
\\\`\\\`\\\``,
                difficulty: 'Easy',
                tags: ['String', 'Stack'],
                constraints: '1 <= s.length <= 10^4',
                input_format: 'A single string.',
                output_format: 'true or false',
                time_limit: 1000,
                memory_limit: 128,
            },
        ];

        for (const p of problems) {
            const res = await query(`
        INSERT INTO problems (title, slug, description, difficulty, tags, constraints, input_format, output_format, time_limit, memory_limit, is_published, author_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11)
        ON CONFLICT (slug) DO NOTHING
        RETURNING id
      `, [p.title, p.slug, p.description, p.difficulty, p.tags, p.constraints, p.input_format, p.output_format, p.time_limit, p.memory_limit, setterId]);

            const problemId = res.rows[0]?.id;
            if (!problemId) continue;

            // Add test cases for Two Sum
            if (p.slug === 'two-sum') {
                await query(`
          INSERT INTO test_cases (problem_id, input, expected_output, is_sample, order_index) VALUES
          ($1, '4 9\n2 7 11 15', '0 1', true, 0),
          ($1, '3 6\n3 2 4', '1 2', true, 1),
          ($1, '2 6\n3 3', '0 1', false, 2),
          ($1, '5 15\n1 2 3 4 11', '3 4', false, 3)
          ON CONFLICT DO NOTHING
        `, [problemId]);
            }

            if (p.slug === 'valid-parentheses') {
                await query(`
          INSERT INTO test_cases (problem_id, input, expected_output, is_sample, order_index) VALUES
          ($1, '()', 'true', true, 0),
          ($1, '()[]{} ', 'true', true, 1),
          ($1, '(]', 'false', false, 2),
          ($1, '([)]', 'false', false, 3),
          ($1, '{[]}', 'true', false, 4)
          ON CONFLICT DO NOTHING
        `, [problemId]);
            }

            if (p.slug === 'longest-substring-without-repeating') {
                await query(`
          INSERT INTO test_cases (problem_id, input, expected_output, is_sample, order_index) VALUES
          ($1, 'abcabcbb', '3', true, 0),
          ($1, 'bbbbb', '1', true, 1),
          ($1, 'pwwkew', '3', false, 2),
          ($1, '', '0', false, 3)
          ON CONFLICT DO NOTHING
        `, [problemId]);
            }
        }

        // Seed a Sample Contest
        const adminRes = await query(`SELECT id FROM users WHERE username='admin'`);
        const adminId = adminRes.rows[0]?.id;

        const now = new Date();
        const contestStart = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Tomorrow
        const contestEnd = new Date(contestStart.getTime() + 3 * 60 * 60 * 1000); // 3 hours

        await query(`
      INSERT INTO contests (title, slug, description, rules, start_time, end_time, status, is_public, author_id)
      VALUES (
        'CodeRunner Weekly #1',
        'coderunner-weekly-1',
        'Welcome to the first CodeRunner Weekly Contest! This beginner-friendly contest features classic problems.',
        '1. No sharing of solutions during the contest.\n2. Multiple submissions allowed; penalty applies for wrong answers.\n3. Final rankings based on score, then penalty time.',
        $1, $2, 'upcoming', true, $3
      )
      ON CONFLICT (slug) DO NOTHING
    `, [contestStart, contestEnd, adminId]);

        logger.info('Database seeded successfully!');
    } catch (err) {
        logger.error('Seed failed:', err.message);
        throw err;
    } finally {
        await pool.end();
    }
}

seed().catch((err) => {
    console.error(err);
    process.exit(1);
});
