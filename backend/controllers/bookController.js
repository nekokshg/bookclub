//Contains the logic for implementing book requests
/**
 * This includes:
 * Find or create a book (POST)
 * Add tag to book (POST)
 * Get book data from Google Books (GET)
 * Querying the database for all books with optional search and filter parameters (GET) - to list books by title, genre, author, etc...
 * Vote on tag for an existing book (PATCH)
 * Update an existing book (PATCH)
 * Favorite/unfavoriting a book (updating popularity count) (PATCH)
 * Deleting a book (DELETE)
 */
const axios = require('axios');
const Book = require('../models/book');
const Review = require('../models/review');
const Tag = require('../models/tag');
const User = require('../models/user');

const { createTag, updateTagPopularity } = require('../controllers/tagController');
const { fetchByTitle, fetchByISBN } = require('../utils/openLibraryAPI');

//Get book by title
const getBook = async(title) => {
    return await Book.findOne({ title: { $regex: title, $options: 'i' } });
}

// Create a book in the database
const createBook = async (searchQuery) => {
    try {
        const {title, author, genre, isbn} = searchQuery;

        let bookData;

        if (title) {
            bookData = await fetchByTitle(title);
        }

        else if (isbn) {
            //Check if its a valid isbn and if we have book in our db but just havent added the isbn
            let response = await axios.get(`https://openlibrary.org/search.json?isbn=${isbn}`);
            if (!response.data.docs || response.data.docs.length === 0) throw new Error('No results found invalid isbn');
            let book = response.data.docs[0];
            let findBook = await getBook(book.title);
            if (findBook) {
                //Add the ISBN if it's not already in the array
                findBook = await Book.findOneAndUpdate(
                    {_id: findBook._id},
                    {$addToSet: {isbns: isbn}},
                    {new: true} //Returns the updated doc
                );
                return [findBook];
            }
            //Else, create the book by the isbn
            bookData = await fetchByISBN(isbn);
        }
  
        // Create a new book if data is valid
        const newBook = new Book({
            title: bookData.title,
            authors: bookData.authors,
            genres: [], //<= fix later will implement ML to categorize book title and description to genres
            tags: [], //Tags are added later by the users
            description: bookData.description,
            publishedYear: bookData.publishedYear,
            coverImage: bookData.coverImage,  // Store the cover image URL
            OLKey: bookData.OLKey,
            isbns: bookData.isbns,
        });
    
        // Save the new book to the database
        await newBook.save();

        // Return the newly created book
        return [newBook];
    } catch (error) {
        res.status(500).json({ message: 'Error processing your request', error });
    }
};

// Add tag to a book
const addTagToBook = async (req, res) => {
    try {
        const { bookId } = req.params;
        const { tagName } = req.body;

        const book = await Book.findById(bookId);
        if (!book) return res.status(404).json({ message: 'Book not found' });

        // Check if the book already has this tag
        const tagExists = book.tags.some(t => t.tagId.name.toLowerCase() === tagName.toLowerCase());
        if (tagExists) return res.status(400).json({ message: 'Tag is already added to this book' });

        // Use TagController to create or fetch the tag
        let tag = await createTag(tagName);  // Create or find the tag by name

        // Add tag to the book's tags array (book-specific popularityCount is 0)
        book.tags.push({
            tagId: tag._id,
            popularityCount: 0,  // Initially, the popularity count for this book is 0
        });

        await book.save();

        // Increment the global popularity count of the tag using TagController
        await updateTagPopularity(tag._id, 1);  // Increment global popularity by 1

        res.status(200).json(book);
    } catch (error) {
        res.status(500).json({ message: 'Error adding tag to book', error });
    }
};

// Vote on a tag for a book (upvote or downvote)
const voteOnTagForBook = async (req, res) => {
    try {
        const { bookId, tagId } = req.params;
        const { vote } = req.body;  // Get the vote (1 for like, -1 for dislike)

        // Error check: vote must be either 1 or -1
        if (![1, -1].includes(vote)) return res.status(400).json({ message: 'Invalid vote value' });

        const book = await Book.findById(bookId);
        if (!book) return res.status(404).json({ message: 'Book not found' });

        // Check if the tag is associated with the book
        const tag = book.tags.find(t => t.tagId.toString() === tagId);
        if (!tag) return res.status(400).json({ message: 'Tag not associated with this book' });

        // Increment or decrement the book-specific popularity count based on the vote
        if (vote === 1) {
            tag.popularityCount += 1;
        } else {
            tag.popularityCount -= 1;
        }

        await book.save();

        // Update the global popularity count of the tag using TagController
        await updateTagPopularity(tagId, vote);  // Update global popularity (increment or decrement)

        res.status(200).json(book);
    } catch (error) {
        res.status(500).json({ message: 'Error voting on tag for book', error });
    }
};

//Query and get books with the optional search and filter parameters
const filterAndGetBooks = async (req,res) => {
    const { title, authors, genre, tag, publishedYear, minReviewRating, isbn } = req.query;
    console.log(req.query)
    const query = {}; //Query object that will be used to filter books in the database

    //Filter by title (optional)
    if (title) {
        //If a title filter is provided, use a case-insensitive regular expression to match the title
        query.title = { $regex: title, $options: 'i' }; //i = case-insensitive search
    }

    //Filter by authors (optional)
    if (authors) {
        console.log(authors)
        const authorsArray = authors.split(',').map(a => a.trim());
        // Ensure the book has ALL the given author names in some form (accounting for the fact that the user might be lazy and only put in first name not full name)
        query.$and = authorsArray.map(name => ({
            authors: { $regex: name, $options: 'i' }
        }));
    }

    //Filter by genre (optional)
    //When a user filters by multiple genres (e.g., Romance and Action), want to apply AND logic and return books that match both genres
    /**
     * Note: in MongoDB
     * -use $in operator to match any of the selected genres (OR logic)
     * -use $all to match all of the selected genres (AND logic)
     */
    if (genre) {
        const genresArray = genre.split(',').map(g => g.trim()); //Split the generes passed as a comma-separated list (e.g., Romance, Historical) and remove extra spaces
        query.genres = { $all: genresArray }; //Match any books that has all of the genres in the array
    }

    //Filter by tag (optional)
    if (tag) {
        const tagsArray = tag.split(',').map(t => t.trim());
        const tags = await Tag.find({ name: { $in: tagsArray }}); //Find the tag documents from the Subgenre model that match any of the names in the subgenresArray. Gives the subgenre IDs that'll be used for filtering the books
        if (tags.length > 0) {
            query.tags = { $all: tags.map(t => t._id)}; //If valid tags exist, filter books that have all the tag IDs
        }
    }   

    //Filter by published year (optional)
    if (publishedYear) {
        query.publishedYear = publishedYear;
    }

    //Filter by minimum review rating (optional)
    if (minReviewRating) {
        //Query Review model and find books that have a rating >= minReviewRating
        const booksWithGoodReviews = await Review.aggregate([ //Aggregation query allows the performance of complex operations on the data in the database (e.g., filter, group, sort, and transform data)
            {$match: { rating: { $gte: minReviewRating }}}, //Match reviews with ratings >= minReviewRating
            {$group: {_id: "$bookId"}} //Group by bookId to get the list of bookIds with good reviews
        ]);
        const bookIds = booksWithGoodReviews.map(review => review._id);
        query._id = {$in: bookIds}; //Don't need to check if the book has all of the book IDs from the aggregation query. We just need to find books that match any of the valid bookIds that have reviews >= minReviewRating
    }

    if (isbn) {
        const isbnArray = isbn.split(',').map(i => i.trim()); //Convert input into an array
        query.isbns = {$in: isbnArray}; //Match any book that has one of the isbns in the input array
    }

    try {
        let books = await Book.find(query)
            .populate('tags') //Tells Mongoose to replace the tags field (which contains an array of tag IDs) with the actual tag documents
        
        //Check if the query has genres, tags or authors we do not want to create a book then
        if (books.length === 0 && (title || isbn) && !minReviewRating && !genre && !tag && !authors && !publishedYear) {
            console.log('No books found, attempting to create');
            books = await createBook(req.query);
        }
        res.status(200).json(books);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching books', error });
    }
}

//Update an existing book 
const updateBookById = async (req, res) => {
    try {
        const { bookId } = req.params;
        const { title, authors, genres, tags, description, publishedYear } = req.body;
        const book = await Book.findById(bookId);
        if (!book) return res.status(404).json({message: 'Book not found'});
        if (tags) {
            //Look up the ObjectIds for the provided tag names
            const tagIds = await Tag.find({name: {$in: tags}}).select('_id');
            //Replace the existing subgenres with the new subgenreObjectIds
            book.tags = tagIds.map(t => t._id);
        }
        //Update only the fields provided in the request body
        if (title) book.title = title;
        if (authors) book.authors = authors;
        if (genres) book.genres = genres;
        if (description) book.description = description;
        if (publishedYear) book.publishedYear = publishedYear;
        await book.save();
        res.status(200).json(book);
    } catch (error) {
        res.status(500).json({message: 'Error updating book', error});
    }
}

//Favorite/unfavorite a book
const favoriteBook = async (req, res) => {
    const {userId, bookId} = req.params;
    try {
        const user = await User.findById(userId);
        const book = await Book.findById(bookId);

        if (!user || !book) return res.status(404).json({message: 'User or book not found'});

        //Check if book is already favorited by user 
        const isFavorited = user.favoriteBooks.includes(bookId);

        if (isFavorited) {
            //User wants to unfavorite, so decrement the popularity count
            await Book.findById(bookId, {$inc: {popularity: -1 }});
            //Remove the book from the user's favorites list
            await User.findByIdAndUpdate(userId, {$pull: {favoriteBooks: bookId}});
            return res.status(200).json({message: 'Book unfavorited'});
        } else {
            //User wants to favorite, so increment the popularity count
            await Book.findById(bookId, {$inc: {popularity: 1}});
            //Add book to the user's favorites list
            await User.findByIdAndUpdate(userId, {$push: {favoriteBooks: bookId}});
            return res.status(200).json({message: 'Book favorited'});
        }
    } catch (error) {
        res.status(500).json({message: 'Error handling favorite/unfavorite', error});
    }
}

//Delete an existing book by ID
const deleteBookById = async (req, res) => {
    try{
        const { bookId } = req.params;
        const book = Book.findById(bookId);
        if (!book) return res.status(400).json({message: 'Book not found'});
        await book.remove();
        res.status(204).send();
    } catch (error) {
        res.status(500).json({message: 'Unable to delete book', error});
    }
}

module.exports= { createBook, addTagToBook, voteOnTagForBook, filterAndGetBooks, updateBookById, favoriteBook, deleteBookById };