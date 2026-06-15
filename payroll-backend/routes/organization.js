// ====================================
// 🏢 Organization & Structure Routes
// ====================================
// Departments, cost centers, organizational hierarchy,
// salary history, pay grades.

'use strict';

const express = require('express');
const { body, param, query } = require('express-validator');
const crypto = require('crypto');
const db = require('../db');
const { authenticateToken, requireRole, validate, auditLog } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

async function getCompanyId(userId) {
    const user = await db.getOne('SELECT company_id FROM users WHERE id = ?', [userId]);
    return user?.company_id;
}

// ====================================
// DEPARTMENTS
// ====================================

// GET /api/v2/organization/departments — List departments (tree structure)
router.get('/departments', async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const departments = await db.getAll(`
            SELECT d.*, 
                   e.name as manager_name, e.uuid as manager_uuid,
                   pd.name as parent_name,
                   (SELECT COUNT(*) FROM employees emp WHERE emp.department_id = d.id AND emp.status = 'active') as employee_count
            FROM departments d
            LEFT JOIN employees e ON d.manager_employee_id = e.id
            LEFT JOIN departments pd ON d.parent_department_id = pd.id
            WHERE d.company_id = ? AND d.is_active = 1
            ORDER BY d.name
        `, [companyId]);

        // Build tree structure
        const tree = buildDepartmentTree(departments);

        res.json({ departments, tree });
    } catch (error) {
        console.error('List departments error:', error);
        res.status(500).json({ error: 'Chyba při načítání oddělení' });
    }
});

// POST /api/v2/organization/departments — Create department
router.post('/departments', [
    body('name').trim().notEmpty().withMessage('Název oddělení je povinný'),
    body('code').optional().trim(),
    body('parent_department_uuid').optional().trim(),
    body('manager_employee_uuid').optional().trim(),
    body('cost_center_code').optional().trim(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        let parentId = null;
        if (req.body.parent_department_uuid) {
            const parent = await db.getOne(
                'SELECT id FROM departments WHERE uuid = ? AND company_id = ?',
                [req.body.parent_department_uuid, companyId]
            );
            parentId = parent?.id || null;
        }

        let managerId = null;
        if (req.body.manager_employee_uuid) {
            const manager = await db.getOne(
                'SELECT id FROM employees WHERE uuid = ? AND company_id = ?',
                [req.body.manager_employee_uuid, companyId]
            );
            managerId = manager?.id || null;
        }

        const uuid = crypto.randomUUID();
        await db.run(`
            INSERT INTO departments (uuid, company_id, name, code, parent_department_id, manager_employee_id, cost_center_code)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [uuid, companyId, req.body.name, req.body.code || null, parentId, managerId, req.body.cost_center_code || null]);

        await auditLog('DEPARTMENT_CREATED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'department',
            resourceId: uuid,
            ip: req.ip,
            metadata: { name: req.body.name },
        });

        const dept = await db.getOne('SELECT * FROM departments WHERE uuid = ?', [uuid]);
        res.status(201).json({ success: true, department: dept });
    } catch (error) {
        console.error('Create department error:', error);
        res.status(500).json({ error: 'Chyba při vytváření oddělení' });
    }
});

// PUT /api/v2/organization/departments/:uuid — Update department
router.put('/departments/:uuid', [
    param('uuid').trim().notEmpty(),
    body('name').optional().trim().notEmpty(),
    body('code').optional().trim(),
    body('manager_employee_uuid').optional().trim(),
    body('cost_center_code').optional().trim(),
    body('is_active').optional().isBoolean(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const existing = await db.getOne(
            'SELECT * FROM departments WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );
        if (!existing) return res.status(404).json({ error: 'Oddělení nenalezeno' });

        const updates = {};
        if (req.body.name !== undefined) updates.name = req.body.name;
        if (req.body.code !== undefined) updates.code = req.body.code;
        if (req.body.cost_center_code !== undefined) updates.cost_center_code = req.body.cost_center_code;
        if (req.body.is_active !== undefined) updates.is_active = req.body.is_active ? 1 : 0;

        if (req.body.manager_employee_uuid !== undefined) {
            if (req.body.manager_employee_uuid) {
                const manager = await db.getOne(
                    'SELECT id FROM employees WHERE uuid = ? AND company_id = ?',
                    [req.body.manager_employee_uuid, companyId]
                );
                updates.manager_employee_id = manager?.id || null;
            } else {
                updates.manager_employee_id = null;
            }
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'Žádné údaje k aktualizaci' });
        }

        const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`);
        setClauses.push('updated_at = NOW()');
        const values = Object.values(updates);
        values.push(req.params.uuid, companyId);

        await db.run(
            `UPDATE departments SET ${setClauses.join(', ')} WHERE uuid = $${values.length - 1} AND company_id = $${values.length}`,
            values
        );

        const updated = await db.getOne('SELECT * FROM departments WHERE uuid = ?', [req.params.uuid]);
        res.json({ success: true, department: updated });
    } catch (error) {
        console.error('Update department error:', error);
        res.status(500).json({ error: 'Chyba při aktualizaci oddělení' });
    }
});

// POST /api/v2/organization/departments/:uuid/assign — Assign employee to department
router.post('/departments/:uuid/assign', [
    param('uuid').trim().notEmpty(),
    body('employee_uuid').trim().notEmpty().withMessage('UUID zaměstnance je povinné'),
    body('position_title').optional().trim(),
    body('position_code').optional().trim(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const dept = await db.getOne(
            'SELECT id FROM departments WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );
        if (!dept) return res.status(404).json({ error: 'Oddělení nenalezeno' });

        const employee = await db.getOne(
            'SELECT id FROM employees WHERE uuid = ? AND company_id = ?',
            [req.body.employee_uuid, companyId]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        await db.run(`
            UPDATE employees SET department_id = ?, position_title = COALESCE(?, position_title),
            position_code = COALESCE(?, position_code), updated_at = NOW()
            WHERE id = ? AND company_id = ?
        `, [dept.id, req.body.position_title || null, req.body.position_code || null, employee.id, companyId]);

        res.json({ success: true, message: 'Zaměstnanec přiřazen k oddělení' });
    } catch (error) {
        console.error('Assign to department error:', error);
        res.status(500).json({ error: 'Chyba při přiřazení k oddělení' });
    }
});

// ====================================
// COST CENTERS
// ====================================

// GET /api/v2/organization/cost-centers
router.get('/cost-centers', async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const centers = await db.getAll(
            'SELECT * FROM cost_centers WHERE company_id = ? AND is_active = 1 ORDER BY code',
            [companyId]
        );
        res.json({ cost_centers: centers });
    } catch (error) {
        console.error('List cost centers error:', error);
        res.status(500).json({ error: 'Chyba při načítání středisek' });
    }
});

// POST /api/v2/organization/cost-centers
router.post('/cost-centers', [
    body('code').trim().notEmpty().withMessage('Kód střediska je povinný'),
    body('name').trim().notEmpty().withMessage('Název střediska je povinný'),
    body('description').optional().trim(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const uuid = crypto.randomUUID();
        await db.run(`
            INSERT INTO cost_centers (uuid, company_id, code, name, description)
            VALUES (?, ?, ?, ?, ?)
        `, [uuid, companyId, req.body.code, req.body.name, req.body.description || null]);

        const center = await db.getOne('SELECT * FROM cost_centers WHERE uuid = ?', [uuid]);
        res.status(201).json({ success: true, cost_center: center });
    } catch (error) {
        console.error('Create cost center error:', error);
        if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
            return res.status(409).json({ error: 'Středisko s tímto kódem již existuje' });
        }
        res.status(500).json({ error: 'Chyba při vytváření střediska' });
    }
});

// ====================================
// PAY GRADES / TARIFNÍ TŘÍDY
// ====================================

// GET /api/v2/organization/pay-grades
router.get('/pay-grades', async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const grades = await db.getAll(
            'SELECT * FROM pay_grades WHERE company_id = ? AND is_active = 1 ORDER BY min_salary',
            [companyId]
        );

        // Add employee count per grade
        for (const g of grades) {
            const count = await db.getOne(
                `SELECT COUNT(*) as cnt FROM employees WHERE pay_grade_id = ? AND status = 'active'`,
                [g.id]
            );
            g.employee_count = count?.cnt || 0;
        }

        res.json({ pay_grades: grades });
    } catch (error) {
        console.error('List pay grades error:', error);
        res.status(500).json({ error: 'Chyba při načítání platových tříd' });
    }
});

// POST /api/v2/organization/pay-grades
router.post('/pay-grades', [
    body('code').trim().notEmpty().withMessage('Kód třídy je povinný'),
    body('name').trim().notEmpty().withMessage('Název třídy je povinný'),
    body('min_salary').isInt({ min: 0 }).withMessage('Minimální mzda je povinná'),
    body('max_salary').isInt({ min: 0 }).withMessage('Maximální mzda je povinná'),
    body('mid_salary').optional().isInt({ min: 0 }),
    body('description').optional().trim(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const uuid = crypto.randomUUID();
        const { code, name, min_salary, max_salary, mid_salary, description } = req.body;

        await db.run(`
            INSERT INTO pay_grades (uuid, company_id, code, name, min_salary, mid_salary, max_salary, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [uuid, companyId, code, name, min_salary, mid_salary || Math.round((min_salary + max_salary) / 2), max_salary, description || null]);

        const grade = await db.getOne('SELECT * FROM pay_grades WHERE uuid = ?', [uuid]);
        res.status(201).json({ success: true, pay_grade: grade });
    } catch (error) {
        console.error('Create pay grade error:', error);
        if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
            return res.status(409).json({ error: 'Platová třída s tímto kódem již existuje' });
        }
        res.status(500).json({ error: 'Chyba při vytváření platové třídy' });
    }
});

// ====================================
// SALARY HISTORY
// ====================================

// GET /api/v2/organization/salary-history/:employee_uuid — Salary timeline
router.get('/salary-history/:employee_uuid', [
    param('employee_uuid').trim().notEmpty(),
], validate, async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const employee = await db.getOne(
            'SELECT id, name FROM employees WHERE uuid = ? AND company_id = ?',
            [req.params.employee_uuid, companyId]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        const history = await db.getAll(`
            SELECT sh.*, 
                   u.email as approved_by_email,
                   u2.email as created_by_email,
                   d1.name as previous_department_name,
                   d2.name as new_department_name
            FROM salary_history sh
            LEFT JOIN users u ON sh.approved_by = u.id
            LEFT JOIN users u2 ON sh.created_by = u2.id
            LEFT JOIN departments d1 ON sh.previous_department_id = d1.id
            LEFT JOIN departments d2 ON sh.new_department_id = d2.id
            WHERE sh.employee_id = ? AND sh.company_id = ?
            ORDER BY sh.effective_date DESC
        `, [employee.id, companyId]);

        res.json({ employee: employee.name, history });
    } catch (error) {
        console.error('Salary history error:', error);
        res.status(500).json({ error: 'Chyba při načítání historie mezd' });
    }
});

// POST /api/v2/organization/salary-history — Record salary change
router.post('/salary-history', [
    body('employee_uuid').trim().notEmpty().withMessage('UUID zaměstnance je povinné'),
    body('effective_date').isDate().withMessage('Datum účinnosti je povinné'),
    body('new_salary').isInt({ min: 0 }).withMessage('Nová mzda je povinná'),
    body('change_reason').isIn(['hire', 'promotion', 'annual_review', 'merit', 'adjustment', 'demotion', 'transfer', 'legislation', 'other']),
    body('new_position').optional().trim(),
    body('new_department_uuid').optional().trim(),
    body('notes').optional().trim(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const employee = await db.getOne(
            'SELECT id, hruba_mzda_czk, position_title, department_id FROM employees WHERE uuid = ? AND company_id = ?',
            [req.body.employee_uuid, companyId]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        let newDeptId = null;
        if (req.body.new_department_uuid) {
            const dept = await db.getOne(
                'SELECT id FROM departments WHERE uuid = ? AND company_id = ?',
                [req.body.new_department_uuid, companyId]
            );
            newDeptId = dept?.id || null;
        }

        // Close previous salary record
        await db.run(`
            UPDATE salary_history SET end_date = ?
            WHERE employee_id = ? AND company_id = ? AND end_date IS NULL
        `, [req.body.effective_date, employee.id, companyId]);

        const uuid = crypto.randomUUID();
        await db.run(`
            INSERT INTO salary_history (
                uuid, employee_id, company_id, effective_date,
                previous_salary, new_salary, change_reason,
                previous_position, new_position,
                previous_department_id, new_department_id,
                notes, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            uuid, employee.id, companyId, req.body.effective_date,
            employee.hruba_mzda_czk, req.body.new_salary, req.body.change_reason,
            employee.position_title || null, req.body.new_position || null,
            employee.department_id || null, newDeptId,
            req.body.notes || null, req.user.userId,
        ]);

        // Update employee's actual salary
        const updateFields = { hruba_mzda_czk: req.body.new_salary, salary: req.body.new_salary };
        if (req.body.new_position) updateFields.position_title = req.body.new_position;
        if (newDeptId) updateFields.department_id = newDeptId;

        const setClauses = Object.keys(updateFields).map((k, i) => `${k} = $${i + 1}`);
        setClauses.push('updated_at = NOW()');
        const values = Object.values(updateFields);
        values.push(req.body.employee_uuid, companyId);

        await db.run(
            `UPDATE employees SET ${setClauses.join(', ')} WHERE uuid = $${values.length - 1} AND company_id = $${values.length}`,
            values
        );

        await auditLog('SALARY_CHANGED', {
            userId: req.user.userId,
            userEmail: req.user.email,
            resourceType: 'salary_history',
            resourceId: uuid,
            ip: req.ip,
            metadata: {
                previousSalary: employee.hruba_mzda_czk,
                newSalary: req.body.new_salary,
                reason: req.body.change_reason,
            },
        });

        const record = await db.getOne('SELECT * FROM salary_history WHERE uuid = ?', [uuid]);
        res.status(201).json({ success: true, salary_change: record });
    } catch (error) {
        console.error('Record salary change error:', error);
        res.status(500).json({ error: 'Chyba při zaznamenání změny mzdy' });
    }
});

// ====================================
// EMPLOYEE SUPERVISOR (set nadřízený)
// ====================================

// PUT /api/v2/organization/employees/:uuid/supervisor
router.put('/employees/:uuid/supervisor', [
    param('uuid').trim().notEmpty(),
    body('supervisor_uuid').optional({ nullable: true }).trim(),
], validate, requireRole(['admin', 'employer']), async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const employee = await db.getOne(
            'SELECT id FROM employees WHERE uuid = ? AND company_id = ?',
            [req.params.uuid, companyId]
        );
        if (!employee) return res.status(404).json({ error: 'Zaměstnanec nenalezen' });

        let supervisorId = null;
        if (req.body.supervisor_uuid) {
            const supervisor = await db.getOne(
                'SELECT id FROM employees WHERE uuid = ? AND company_id = ?',
                [req.body.supervisor_uuid, companyId]
            );
            if (!supervisor) return res.status(404).json({ error: 'Nadřízený nenalezen' });
            supervisorId = supervisor.id;
        }

        await db.run(
            'UPDATE employees SET supervisor_id = ?, updated_at = NOW() WHERE id = ? AND company_id = ?',
            [supervisorId, employee.id, companyId]
        );

        res.json({ success: true, message: 'Nadřízený nastaven' });
    } catch (error) {
        console.error('Set supervisor error:', error);
        res.status(500).json({ error: 'Chyba při nastavení nadřízeného' });
    }
});

// GET /api/v2/organization/org-chart — Full org chart
router.get('/org-chart', async (req, res) => {
    try {
        const companyId = await getCompanyId(req.user.userId);
        if (!companyId) return res.status(400).json({ error: 'Nejprve nastavte firmu' });

        const employees = await db.getAll(`
            SELECT e.uuid, e.name, e.position_title, e.department_id,
                   e.supervisor_id, e.status,
                   d.name as department_name,
                   s.uuid as supervisor_uuid, s.name as supervisor_name
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.id
            LEFT JOIN employees s ON e.supervisor_id = s.id
            WHERE e.company_id = ? AND e.status = 'active'
            ORDER BY e.name
        `, [companyId]);

        res.json({ employees });
    } catch (error) {
        console.error('Org chart error:', error);
        res.status(500).json({ error: 'Chyba při načítání organizačního schématu' });
    }
});

// ====================================
// HELPERS
// ====================================

function buildDepartmentTree(departments) {
    const map = {};
    const roots = [];

    for (const d of departments) {
        map[d.id] = { ...d, children: [] };
    }

    for (const d of departments) {
        if (d.parent_department_id && map[d.parent_department_id]) {
            map[d.parent_department_id].children.push(map[d.id]);
        } else {
            roots.push(map[d.id]);
        }
    }

    return roots;
}

module.exports = router;
