import { Link } from 'react-router-dom';
import { Code2, User } from 'lucide-react';
import './Navbar.css';

const Navbar = () => {
    return (
        <nav className="navbar glass-panel">
            <div className="nav-container">
                <Link to="/" className="nav-brand">
                    <Code2 className="brand-icon" size={28} />
                    <span className="gradient-text brand-text">CodeRunner</span>
                </Link>
                <div className="nav-links">
                    <Link to="/" className="nav-link active">
                        <Code2 size={16} /> Online Compiler
                    </Link>
                </div>
                <div className="nav-actions">
                    <button className="btn btn-secondary user-btn">
                        <User size={18} />
                    </button>
                </div>
            </div>
        </nav>
    );
};

export default Navbar;
