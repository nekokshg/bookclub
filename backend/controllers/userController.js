//Handles user-related actions (e.g., login, register)
/**
 * register a user (POST)
 * login a user (POST)
 * get a users favorite books (GET)
 */

const User = require('../models/user');
const { hashPassword, comparePassword, hashPassword } = require('../utils/hashUtils');
const { generateToken } = require('../utils/tokenUtils');

//Register a new user
const registerUser = async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const existingUser = await User.findOne({email});
        if (existingUser) return res.status(400).json({message: 'User already exists'});
        
        //Create and save the new user, password will be automatically hashed by the schema
        const newUser = new User({username, email, password});
        await newUser.save();

        //Generate a token for the user
        const token = generateToken(newUser._id);
        res.status(201).json({token, user: {username, email, favoriteBooks: newUser.favoriteBooks}});
    } catch (error) {
        res.status(500).json({message: 'Error registering user', error});
    }
}

//Login a user
const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({email});
        if (!user) return res.status(400).json({message: 'User not found'});

        //Compare the entered password with the hashed password in the database
        const isMatch = await user.comparePassword(password);
        if (!isMatch) return res.status(400).json({message: 'Invalid password'});

        //Generate token and return user data
        const token = generateToken(user._id);
        res.status(200).json({token, user: {username: user.username, email: user.email, favoriteBooks: user.favoriteBooks}});
    } catch (error) {
        res.status(500).json({message: 'Error logging in user', error});
    }
}

module.exports = {
    registerUser,
    loginUser,
};