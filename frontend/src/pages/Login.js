/**
 * Login Page:
 * -A user enters their credentials
 * -After authentication, the backend returns a JWT Token
 * -The token is stored in localStorage, and the user is redirected to their Profile page (protected)
 */

import React, {useState} from 'react';
import { loginUser } from '../services/userAPI';

const Login = ({setIsAuthenticated}) => {
    const [usernameOrEmail, setUsernameOrEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(''); //To hold error message

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const response = await loginUser({usernameOrEmail, password});
            localStorage.setItem('token', response.token);
            setIsAuthenticated(true);
        } catch (error) {
            setError('Error logging in user, please try again');
        }
    }

    return (
        <div>
            <h1>Login</h1>
            <form onSubmit={handleSubmit}>
                <div>
                    <input 
                        type='text'
                        placeholder='Enter username or email'
                        value={usernameOrEmail}
                        onChange={(e) => setUsernameOrEmail(e.target.value)}
                        required
                    />
                </div>
                <div>
                    <input 
                        type='password'
                        placeholder='Enter your password'
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                </div>
                <button type='submit'>Login</button>
            </form>
        </div>
    )
};

export default Login;