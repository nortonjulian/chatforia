import axios from './axiosClient';

export const fetchLanguages = async () => {
  const res = await axios.get('/api/languages');
  return res.data; 
};
